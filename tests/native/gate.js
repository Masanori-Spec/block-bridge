/* Original BlockBridge consumer gate. Executed by the source-built QCAD CE QtScript engine. */
include("scripts/library.js");

(function () {
    var argv = RSettings.getOriginalArguments();
    function arg(flag) {
        for (var i = 0; i < argv.length - 1; i++) {
            if (argv[i] === flag) { return argv[i + 1]; }
        }
        throw new Error("Missing required harness argument: " + flag);
    }
    var fixtures = arg("-bb-fixtures");
    var output = arg("-bb-output");
    var report = {schema: 1, status: "fail", consumer: "QCAD Community Edition",
        sourceTag: "v3.33.1.0", sourceCommit: "897079c2d11aaa0869f839a6cf5df8a937dbddbe",
        version: RSettings.getVersionString(), tolerance: 0.0000001,
        inspection: "Native REntity.getShapes line endpoints and circle centers/radii; editable block graph",
        baselines: [], cases: [], assertions: 0};
    var phase = "initialization";
    var openDocuments = [];
    function check(ok, message) {
        report.assertions++;
        if (!ok) { throw new Error(message); }
    }
    function closeAll() {
        for (var i = openDocuments.length - 1; i >= 0; i--) { destr(openDocuments[i].di); }
        openDocuments = [];
    }
    function load(name, absolute) {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
        var di = new RDocumentInterface(doc);
        var result = {doc: doc, di: di};
        openDocuments.push(result);
        check(di.importFile(absolute ? name : fixtures + "/" + name) === RDocumentInterface.IoErrorNoError,
            "Native DXF import failed: " + name);
        di.setCurrentBlock(doc.getModelSpaceBlockId());
        return result;
    }
    function near(a, b) { return isFinite(a) && Math.abs(a - b) <= report.tolerance; }
    function rowEqual(a, b) {
        if (a.length !== b.length || a[0] !== b[0]) { return false; }
        for (var i = 1; i < a.length; i++) { if (!near(a[i], b[i])) { return false; } }
        return true;
    }
    function compare(actual, expected, label) {
        check(actual.length === expected.length, label + ": wrong native shape count");
        var remaining = expected.slice();
        for (var i = 0; i < actual.length; i++) {
            var found = -1;
            for (var k = 0; k < remaining.length; k++) {
                if (rowEqual(actual[i], remaining[k])) { found = k; break; }
            }
            check(found !== -1, label + ": unexpected native geometry " + JSON.stringify(actual[i]));
            remaining.splice(found, 1);
        }
    }
    function shapes(doc) {
        var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
        var rows = [];
        for (var i = 0; i < ids.length; i++) {
            var entity = doc.queryEntity(ids[i]);
            check(!isNull(entity), "Model-space entity cannot be read");
            // QCAD performs the nested transforms. This harness never reimplements them.
            var nativeShapes = entity.getShapes();
            for (var j = 0; j < nativeShapes.length; j++) {
                var shape = nativeShapes[j];
                if (isLineShape(shape)) {
                    var a = shape.getStartPoint(), b = shape.getEndPoint();
                    check(near(a.z, 0) && near(b.z, 0), "Non-planar native line");
                    rows.push(["LINE", a.x, a.y, b.x, b.y]);
                } else if (isCircleShape(shape)) {
                    var center = shape.getCenter();
                    check(near(center.z, 0), "Non-planar native circle");
                    rows.push(["CIRCLE", center.x, center.y, shape.getRadius()]);
                } else { check(false, "Unexpected native shape type"); }
            }
        }
        return rows;
    }
    function graph(doc, positive) {
        var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
        check(ids.length === 5, "Merged model must retain five editable block references");
        var refs = {}, sameIds = [];
        for (var i = 0; i < ids.length; i++) {
            var entity = doc.queryEntity(ids[i]);
            check(isBlockReferenceEntity(entity), "Merge flattened a model-space INSERT");
            var name = entity.getReferencedBlockName();
            refs[name] = (refs[name] || 0) + 1;
            if (name === "SAME") { sameIds.push(entity.getReferencedBlockId()); }
        }
        check(sameIds.length === 2 && sameIds[0] === sameIds[1], "SAME is not shared by both INSERTs");
        var allBlocks = doc.queryAllBlocks(), sameDefinitions = 0;
        for (var k = 0; k < allBlocks.length; k++) {
            if (doc.queryBlock(allBlocks[k]).getName() === "SAME") { sameDefinitions++; }
        }
        check(sameDefinitions === 1, "Equivalent SAME was duplicated");
        var sameMembers = doc.queryBlockEntities(doc.getBlockId("SAME"));
        check(sameMembers.length === 1 && isCircleEntity(doc.queryEntity(sameMembers[0])), "SAME definition lost its editable circle");
        if (positive) {
            check(refs.ASSEMBLY === 1 && refs.TRANSFER_ASSEMBLY === 1 && refs.TRANSFER_LEAF === 1,
                "Prepared model has incorrect block names");
            var pairs = [["ASSEMBLY", "LEAF"], ["TRANSFER_ASSEMBLY", "TRANSFER_LEAF"]];
            for (var p = 0; p < pairs.length; p++) {
                var members = doc.queryBlockEntities(doc.getBlockId(pairs[p][0]));
                check(members.length === 1, "ASSEMBLY definition lost nested INSERT");
                var nested = doc.queryEntity(members[0]);
                check(isBlockReferenceEntity(nested) && nested.getReferencedBlockName() === pairs[p][1],
                    "Nested dependency was not preserved");
                var leafMembers = doc.queryBlockEntities(doc.getBlockId(pairs[p][1]));
                check(leafMembers.length === 1 && isLineEntity(doc.queryEntity(leafMembers[0])),
                    "LEAF definition lost editable line");
            }
        }
        return {topLevelInsertCount: ids.length, sameDefinitionCount: sameDefinitions,
            sameReferenceCount: sameIds.length, referenceNames: refs, nestedEditable: positive};
    }
    var targetLine = ["LINE", 105, 5, 105, 25];
    var donorLines = [["LINE", 5, 105, -35, 105], ["LINE", 50, 50, 50, 40]];
    var circles = [["CIRCLE", 202, 2, 3], ["CIRCLE", 2, 2, 3]];
    var intended = [targetLine].concat(donorLines, circles);
    var keep = [targetLine, ["LINE", 5, 105, 5, 125], ["LINE", 50, 50, 45, 50]].concat(circles);
    var overwrite = [["LINE", 105, 5, 65, 5]].concat(donorLines, circles);
    function editAndUndo(loaded) {
        var ids = loaded.doc.queryBlockEntities(loaded.doc.getBlockId("TRANSFER_LEAF"));
        var line = loaded.doc.queryEntity(ids[0]);
        line.setEndPoint(new RVector(0, 30));
        var operation = new RAddObjectOperation(line, false);
        check(!loaded.di.applyOperation(operation).isFailed(), "Editable line change transaction failed");
        compare(shapes(loaded.doc), [targetLine, ["LINE", 5, 105, -55, 105],
            ["LINE", 50, 50, 50, 35]].concat(circles), "Post-reopen definition edit");
        loaded.di.undo();
        compare(shapes(loaded.doc), intended, "Undo restores exact prepared result");
    }
    function baseline(id, inputName, expected, expectedInsertCount) {
        phase = id;
        var source = load(inputName);
        var before = shapes(source.doc);
        compare(before, expected, id + " before native save");
        var file = output + "/" + id + ".dxf";
        check(source.di.exportFile(file, "R15"), id + ": native save failed");
        var reopened = load(file, true);
        var after = shapes(reopened.doc);
        compare(after, expected, id + " after save/reopen");
        var ids = reopened.doc.queryBlockEntities(reopened.doc.getModelSpaceBlockId());
        check(ids.length === expectedInsertCount, id + ": wrong reopened INSERT count");
        for (var i = 0; i < ids.length; i++) {
            check(isBlockReferenceEntity(reopened.doc.queryEntity(ids[i])), id + ": flattened INSERT");
        }
        report.baselines.push({id: id, passed: true, pasteApplied: false, inputDrawing: inputName,
            beforeSave: before, afterReopen: after, topLevelInsertCount: ids.length,
            savedDrawing: id + ".dxf"});
        closeAll();
    }
    function scenario(id, donorName, overwriteBlocks, expected, positive) {
        phase = id;
        var destination = load("target.dxf");
        var source = load(donorName);
        compare(shapes(destination.doc), [targetLine, circles[0]], id + " target baseline");
        compare(shapes(source.doc), donorLines.concat([circles[1]]), id + " donor baseline");
        var operation = new RPasteOperation(source.doc);
        operation.setOffset(new RVector(0, 0));
        operation.setScale(1);
        operation.setRotation(0);
        operation.setOverwriteLayers(false);
        operation.setOverwriteBlocks(overwriteBlocks);
        check(!destination.di.applyOperation(operation).isFailed(), id + ": native paste failed");
        var before = shapes(destination.doc);
        compare(before, expected, id + " after native paste");
        graph(destination.doc, positive);
        var file = output + "/" + id + ".dxf";
        // CE's dxflib exporter is R15 / AC1015. No Pro importer/exporter is present.
        check(destination.di.exportFile(file, "R15"), id + ": native save failed");
        var reopened = load(file, true);
        var after = shapes(reopened.doc);
        compare(after, expected, id + " after save/reopen");
        var topology = graph(reopened.doc, positive);
        if (positive) { editAndUndo(reopened); }
        report.cases.push({id: id, passed: true, overwriteBlocks: overwriteBlocks,
            expectedOutcome: positive ? "both drawings preserved" : "specific collision corruption reproduced",
            beforeSave: before, afterReopen: after, blockGraph: topology,
            editAndUndoAfterReopen: positive, savedDrawing: id + ".dxf"});
        closeAll();
    }
    try {
        check(/^3\.33\.1(?:\.|$)/.test(report.version), "Unexpected native QCAD version");
        baseline("target-baseline", "target.dxf", [targetLine, circles[0]], 2);
        baseline("donor-baseline", "donor.dxf", donorLines.concat([circles[1]]), 3);
        scenario("unprepared-keep", "donor.dxf", false, keep, false);
        scenario("unprepared-overwrite", "donor.dxf", true, overwrite, false);
        scenario("outer-only-keep", "outer-only-donor.dxf", false, keep, false);
        scenario("prepared-keep", "expected-prepared-donor.dxf", false, intended, true);
        scenario("prepared-overwrite", "expected-prepared-donor.dxf", true, intended, true);
        report.status = "pass";
    } catch (error) {
        report.failure = {phase: phase, message: String(error.message || error)};
    } finally {
        closeAll();
        if (!writeTextFile(output + "/native-gate.json", JSON.stringify(report, null, 2) + "\n")) {
            throw new Error("Cannot write original native gate summary");
        }
    }
    if (report.status !== "pass") { throw new Error("BlockBridge native geometry gate failed"); }
}());
