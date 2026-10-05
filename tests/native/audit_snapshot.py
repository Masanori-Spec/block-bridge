"""Original read-only full audit snapshot and raw semantic-identity helpers."""
from collections import Counter
import hashlib
import copy
import math
import re
import ezdxf
from ezdxf.lldxf.tagwriter import TagCollector


class SnapshotError(AssertionError):
    pass


def demand(condition, message):
    if not condition:
        raise SnapshotError(message)


def plain(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        demand(math.isfinite(value), "Snapshot contains non-finite number")
        return value
    if isinstance(value, dict):
        return {str(key): plain(item) for key, item in sorted(value.items())}
    if isinstance(value, (list, tuple)) or type(value).__name__ in {"Vec2", "Vec3"}:
        return [plain(item) for item in value]
    raise SnapshotError("Snapshot contains unsupported value type: " + type(value).__name__)


def attributes(document):
    return {handle: {"type": entity.dxftype(), "attributes": plain(entity.dxf.all_existing_dxf_attribs())}
            for handle, entity in document.entitydb.items() if entity.is_alive}


def full_snapshot(document):
    # Export to an in-memory tag collector only. Never call a document/file writer.
    before = attributes(document)
    records = {}
    collector_document = copy.deepcopy(document)
    # ezdxf deepcopy can materialize absent owner=None. Restore the exact original
    # attribute presence in the disposable clone before collecting emitted tags.
    for handle, entity in collector_document.entitydb.items():
        if not entity.is_alive:
            continue
        original_keys = set(before[handle]["attributes"])
        for key in set(entity.dxf.all_existing_dxf_attribs()) - original_keys:
            entity.dxf.discard(key)
    demand(attributes(collector_document) == before, "Collector clone differs from original attributes")
    for handle, entity in collector_document.entitydb.items():
        if not entity.is_alive:
            continue
        collector = TagCollector(dxfversion=document.dxfversion)
        entity.export_dxf(collector)
        records[handle] = {**before[handle], "tags": [[tag.code, plain(tag.value)] for tag in collector.tags]}
    demand(before == attributes(document), "Snapshot collection itself changed DXF attributes")
    dictionary_links = {}
    for entity in document.objects:
        if entity.dxftype() in {"DICTIONARY", "ACDBDICTIONARYWDFLT"}:
            dictionary_links[entity.dxf.handle] = sorted(
                [str(key), value if isinstance(value, str) else value.dxf.handle]
                for key, value in entity.items())
    tables = {}
    for table in document.tables.tables():
        tables[table.name] = {"head": table._head.dxf.handle,
                             "entries": sorted(entity.dxf.handle for entity in table)}
    blocks = {}
    for block in document.blocks:
        blocks[block.name] = {"record": block.block_record.dxf.handle,
                             "begin": block.block.dxf.handle, "end": block.endblk.dxf.handle,
                             "entities": [entity.dxf.handle for entity in block]}
    return {
        "entities": records,
        "header": {key: plain(var.value) for key, var in document.header.hdrvars.items()},
        "dictionaryLinks": dictionary_links, "tableMembership": tables, "blockMembership": blocks,
        "sectionMembership": {
            "entities": [entity.dxf.handle for entity in document.entities],
            "objects": [entity.dxf.handle for entity in document.objects],
            "classes": [plain(entity.dxf.all_existing_dxf_attribs()) for entity in document.classes],
            "stored": [str(section.name) for section in document.stored_sections],
        },
    }


def raw_records(raw):
    demand(raw.isascii(), "Raw fixture is not ASCII")
    lines = raw.decode("ascii").splitlines()
    demand(len(lines) % 2 == 0, "Raw DXF has odd tag-line count")
    result = []
    for index in range(0, len(lines), 2):
        code, value = int(lines[index].strip()), lines[index + 1].strip()
        if code == 0:
            result.append([[code, value]])
        elif result:
            result[-1].append([code, value])
        else:
            demand(code == 999, "Unexpected tag before first raw record")
    return result


def only(record, code, default=None):
    values = [value for key, value in record if key == code]
    demand(len(values) <= 1, "Duplicate raw singleton tag")
    return values[0] if values else default


def common_owner(tags):
    """Find only the base entity's owner, preserving later subclass 330 meanings."""
    owners, depth = [], 0
    for code, value in tags:
        if code == 100:
            break
        if code == 102:
            depth = depth + 1 if str(value).startswith("{") else depth - 1
            demand(depth >= 0, "Unbalanced raw extended group")
        elif code == 330 and depth == 0:
            owners.append(value)
    demand(len(owners) <= 1 and depth == 0, "Multiple owners or unbalanced base group")
    return owners[0] if owners else None


def without_common_owner(tags):
    common_owner(tags)  # validates uniqueness before any removal
    result, depth, base = [], 0, True
    for tag in tags:
        code, value = tag
        if code == 100:
            base = False
        if base and code == 102:
            depth = depth + 1 if str(value).startswith("{") else depth - 1
        if base and depth == 0 and code == 330:
            continue
        result.append(tag)
    return result


def semantic_index(raw):
    records = raw_records(raw)
    identities, inverse, by_handle, objects = {}, {}, {}, {}
    section, table = None, None

    def identify(handle, identity):
        demand(handle not in identities, "Duplicate semantic handle identity")
        demand(identity not in inverse, "Duplicate semantic path identity")
        identities[handle], inverse[identity] = identity, handle

    for record in records:
        kind = record[0][1]
        if kind == "SECTION":
            section = only(record, 2)
            continue
        if kind == "ENDSEC":
            section, table = None, None
            continue
        if kind == "ENDTAB":
            table = None
            continue
        if section not in {"TABLES", "BLOCKS", "ENTITIES", "OBJECTS"}:
            continue
        handle = only(record, 105 if kind == "DIMSTYLE" else 5)
        if handle is None:
            continue
        handle = handle.upper()
        demand(handle not in by_handle, "Duplicate raw handle")
        by_handle[handle] = {"type": kind, "tags": record, "owner": common_owner(record)}
        if section == "TABLES":
            if kind == "TABLE":
                table = only(record, 2)
                demand(table is not None, "Unnamed raw table")
                identify(handle, "TABLE/" + table)
            else:
                demand(table is not None, "Table entry outside table")
                name = only(record, 2)
                demand(name is not None, "Unnamed raw table entry")
                identify(handle, "TABLE/" + table + "/" + name)
        if section == "OBJECTS":
            objects[handle] = record
    roots = [handle for handle, record in objects.items() if record[0][1] == "DICTIONARY"]
    if roots:
        def visit(handle, path, ancestors):
            demand(handle not in ancestors, "Raw dictionary cycle")
            demand(handle in objects, "Dangling raw dictionary target")
            identify(handle, path)
            record = objects[handle]
            if record[0][1] not in {"DICTIONARY", "ACDBDICTIONARYWDFLT"}:
                return
            pending, keys = None, set()
            for code, value in record:
                if code == 3:
                    demand(pending is None and value not in keys, "Duplicate or incomplete dictionary key")
                    pending = value
                    keys.add(value)
                elif code in {350, 360}:
                    demand(pending is not None, "Dictionary link lacks key")
                    visit(value.upper(), path + "/" + pending, ancestors | {handle})
                    pending = None
            demand(pending is None, "Unresolved dictionary key")
        visit(roots[0], "ROOT", set())
    return {"identities": identities, "records": by_handle, "sections": [only(r, 2) for r in records if r[0][1] == "SECTION"]}


def audit_entry(entry):
    entity = entry.entity
    handle = entity.dxf.get("handle") if entity is not None and entity.is_alive else None
    entity_type = entity.dxftype() if entity is not None and entity.is_alive else None
    if handle is None:
        match = re.search(r"([A-Z][A-Z0-9_]*)\(#([0-9A-Fa-f]+)\)", entry.message)
        demand(match is not None, "Audit record has unreadable entity identity")
        entity_type, handle = match.group(1), match.group(2).upper()
    return {"code": int(entry.code), "type": entity_type, "handle": handle}


def observe(document):
    before = full_snapshot(document)
    audit = document.audit()
    after = full_snapshot(document)
    return {"before": before, "after": after,
            "errors": [audit_entry(entry) for entry in audit.errors],
            "fixes": [audit_entry(entry) for entry in audit.fixes]}
