"""Original tag-authored owner-complete fixtures; never writes the original family.

No CAD SDK is used for authoring. Explicit table owners and a standard active
viewport avoid the original minimal family's silent owner normalization.
"""
from pathlib import Path
import json
OUT=Path(__file__).resolve().parents[1] / "fixtures" / "owner-complete"
OUT.mkdir(parents=True, exist_ok=True)

def tags(pairs):
    return ''.join(f'{code}\n{value}\n' for code,value in pairs)

def make(name, vertical=False, rename=False):
    names=['LEAF','ASSEMBLY','SAME']
    remap={'LEAF':'TRANSFER_LEAF','ASSEMBLY':'TRANSFER_ASSEMBLY'} if rename else {}
    handles={'*Model_Space':'10','*Paper_Space':'11','LEAF':'12','ASSEMBLY':'13','SAME':'14'}
    out=[(0,'SECTION'),(2,'HEADER'),(9,'$ACADVER'),(1,'AC1015'),(9,'$INSUNITS'),(70,4),(9,'$INSBASE'),(10,0),(20,0),(30,0),(0,'ENDSEC')]
    out += [(0,'SECTION'),(2,'TABLES'),(0,'TABLE'),(2,'LAYER'),(5,'2'),(330,'0'),(100,'AcDbSymbolTable'),(70,1),(0,'LAYER'),(5,'5'),(330,'2'),(100,'AcDbSymbolTableRecord'),(100,'AcDbLayerTableRecord'),(2,'0'),(70,0),(62,7),(6,'CONTINUOUS'),(0,'ENDTAB')]
    out += [(0,'TABLE'),(2,'VPORT'),(5,'6'),(330,'0'),(100,'AcDbSymbolTable'),(70,1),
            (0,'VPORT'),(5,'7'),(330,'6'),(100,'AcDbSymbolTableRecord'),(100,'AcDbViewportTableRecord'),
            (2,'*Active'),(70,0),(10,0),(20,0),(11,1),(21,1),(12,0),(22,0),(13,0),(23,0),
            (14,10),(24,10),(15,10),(25,10),(16,0),(26,0),(36,1),(17,0),(27,0),(37,0),
            (40,200),(41,1.5),(42,50),(43,0),(44,0),(50,0),(51,0),(71,0),(72,100),(73,1),
            (74,3),(75,0),(76,0),(77,0),(78,0),(0,'ENDTAB')]
    out += [(0,'TABLE'),(2,'BLOCK_RECORD'),(5,'3'),(330,'0'),(100,'AcDbSymbolTable'),(70,5)]
    for n,h in handles.items(): out += [(0,'BLOCK_RECORD'),(5,h),(330,'3'),(100,'AcDbSymbolTableRecord'),(100,'AcDbBlockTableRecord'),(2,remap.get(n,n))]
    out += [(0,'ENDTAB'),(0,'ENDSEC'),(0,'SECTION'),(2,'BLOCKS')]
    hid=32
    def ent(kind,owner,props):
        nonlocal hid
        hid+=1
        return [(0,kind),(5,format(hid,'X')),(330,owner),(100,'AcDbEntity'),(8,'0')]+props
    def ins(owner,block,x,y,scale=1,rot=0):
        return ent('INSERT',owner,[(100,'AcDbBlockReference'),(2,remap.get(block,block)),(10,x),(20,y),(30,0),(41,scale),(42,scale),(43,scale),(50,rot)])
    for n,h in handles.items():
        nn=remap.get(n,n)
        out += ent('BLOCK',h,[(100,'AcDbBlockBegin'),(2,nn),(70,0),(10,0),(20,0),(30,0),(3,nn),(1,'')])
        if n=='LEAF': out += ent('LINE',h,[(62,1),(100,'AcDbLine'),(10,0),(20,0),(30,0),(11,0 if vertical else 10),(21,20 if vertical else 0),(31,0)])
        elif n=='ASSEMBLY': out += ins(h,'LEAF',5,5,2,90)
        elif n=='SAME': out += ent('CIRCLE',h,[(62,5),(100,'AcDbCircle'),(10,2),(20,2),(30,0),(40,3)])
        out += ent('ENDBLK',h,[(100,'AcDbBlockEnd')])
    out += [(0,'ENDSEC'),(0,'SECTION'),(2,'ENTITIES')]
    if vertical:
        out += ins('10','ASSEMBLY',0,100)
        out += ins('10','LEAF',50,50,0.5,180)
        out += ins('10','SAME',0,0)
    else:
        out += ins('10','ASSEMBLY',100,0)
        out += ins('10','SAME',200,0)
    out += [(0,'ENDSEC'),(0,'EOF')]
    (OUT/name).write_text(tags(out),encoding='ascii')

make('target.dxf')
make('donor.dxf',True)
make('expected-prepared-donor.dxf',True,True)
expected={
 'units':'mm',
 'target_original_lines':[[105,5,105,25]],
 'donor_intended_lines':[[5,105,-35,105],[50,50,50,40]],
 'unprepared_keep_target_donor_lines':[[5,105,5,125],[50,50,45,50]],
 'unprepared_overwrite_changed_target_lines':[[105,5,65,5]],
 'merged_circles':[[202,2,3],[2,2,3]],
 'rename_map':{'LEAF':'TRANSFER_LEAF','ASSEMBLY':'TRANSFER_ASSEMBLY'},
 'equivalent_reused_block':'SAME',
 'fixture_role':'Original owner-complete tag-authored synthetic fixtures; unchanged handwritten geometry and rename map; native evidence is recorded separately'
}
(OUT/'expected.json').write_text(json.dumps(expected,indent=2)+'\n')
(OUT/'outer-only-donor.dxf').write_bytes((OUT/'expected-prepared-donor.dxf').read_bytes().replace(b'TRANSFER_LEAF', b'LEAF'))
print(OUT)
