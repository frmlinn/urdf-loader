import { describe, it, expect } from 'vitest';
import { Mesh, Object3D } from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFMimicJoint } from '../../src/core/URDFClasses';

async function emptyLoadMeshFunc(): Promise<Object3D> {
    const mesh = new Mesh();
    (mesh as any).fromCallback = true;
    return mesh;
}

function compareRobots(ra: any, rb: any) {
    if (ra.isURDFRobot) {
        expect(Object.keys(ra.links).sort()).toEqual(Object.keys(rb.links).sort());
        expect(Object.keys(ra.joints).sort()).toEqual(Object.keys(rb.joints).sort());
        expect(Object.keys(ra.colliders).sort()).toEqual(Object.keys(rb.colliders).sort());
        expect(Object.keys(ra.visual).sort()).toEqual(Object.keys(rb.visual).sort());
    }

    expect(ra.name).toEqual(rb.name);
    expect(ra.type).toEqual(rb.type);
    expect(ra.urdfName).toEqual(rb.urdfName);

    expect(ra.isMesh).toEqual(rb.isMesh);
    expect(ra.isURDFLink).toEqual(rb.isURDFLink);
    expect(ra.isURDFRobot).toEqual(rb.isURDFRobot);
    expect(ra.isURDFJoint).toEqual(rb.isURDFJoint);
    expect(ra.isURDFCollider).toEqual(rb.isURDFCollider);

    switch (ra.type) {
        case 'URDFJoint':
        case 'URDFMimicJoint':
            expect(ra.jointType).toEqual(rb.jointType);
            expect(ra.axis).toEqual(rb.axis);
            expect(ra.limit).toEqual(rb.limit);
            expect(ra.ignoreLimits).toEqual(rb.ignoreLimits);
            expect(ra.jointValue).toEqual(rb.jointValue);
            expect(ra.origPosition).toEqual(rb.origPosition);
            expect(ra.origQuaternion).toEqual(rb.origQuaternion);
            expect(ra.mimicJoints.map((x: any) => x.urdfName)).toEqual(rb.mimicJoints.map((x: any) => x.urdfName));

            if (ra.type === 'URDFMimicJoint') {
                expect(ra.mimicJoint).toEqual(rb.mimicJoint);
                expect(ra.offset).toEqual(rb.offset);
                expect(ra.multiplier).toEqual(rb.multiplier);
            }
            break;
    }

    for (let i = 0; i < ra.children.length; i++) {
        compareRobots(ra.children[i], rb.children[i]);
    }
}

describe('URDFLoader - Configuración y Opciones', () => {
    describe('parseVisual, parseCollision', () => {
        const urdfXML = `
            <robot name="TEST">
                <link name="LINK1">
                    <visual><geometry><box size="1 1 1"/></geometry></visual>
                    <collision><geometry><box size="1 1 1"/></geometry></collision>
                </link>
            </robot>
        `;

        it('debería excluir los elementos si las flags son false', () => {
            const loader = new URDFLoader();
            loader.parseVisual = false;
            loader.parseCollision = false;
            const robot = loader.parse(urdfXML);
            
            let visTotal = 0; let colTotal = 0;
            robot.traverse(c => {
                if ((c as any).isURDFCollider) colTotal++;
                if ((c as any).isURDFVisual) visTotal++;
            });

            expect(visTotal).toBe(0);
            expect(colTotal).toBe(0);
        });

        it('debería incluir los elementos si las flags son true', () => {
            const loader = new URDFLoader();
            loader.parseVisual = true;
            loader.parseCollision = true;
            const robot = loader.parse(urdfXML);
            
            let visTotal = 0; let colTotal = 0;
            robot.traverse(c => {
                if ((c as any).isURDFCollider) colTotal++;
                if ((c as any).isURDFVisual) visTotal++;
            });

            expect(visTotal).toBe(1);
            expect(colTotal).toBe(1);
        });
    });

    describe('Resolución de Paquetes (packages)', () => {
        const urdf = `
            <robot name="TEST">
                <link name="Body">
                    <visual><geometry><mesh filename="package://pkg1/path/model.stl" /></geometry></visual>
                </link>
            </robot>
        `;

        it('debería usar valores de objeto para resolver rutas', async () => {
            const loader = new URDFLoader();
            loader.packages = { 'pkg1': 'path/to/pkg1' };
            let loadedUrl = '';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await new Promise(resolve => setTimeout(resolve, 5)); // Macro-task wait
            
            expect(loadedUrl).toEqual('path/to/pkg1/path/model.stl');
        });

        it('debería usar valores evaluados por una función', async () => {
            const loader = new URDFLoader();
            loader.packages = (pkg) => pkg === 'pkg1' ? 'func/path/1' : '';
            let loadedUrl = '';
            loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
            
            loader.parse(urdf);
            await new Promise(resolve => setTimeout(resolve, 5));
            
            expect(loadedUrl).toEqual('func/path/1/path/model.stl');
        });
    });
});

describe('Clonado (Clone)', () => {
    it('debería clonar un robot de forma exacta incluso tras renombrarlo', () => {
        const loader = new URDFLoader();
        const robot = loader.parse(`
            <robot name="ORIGINAL">
                <link name="L1"/>
                <joint name="J1" type="continuous"><parent link="L1"/><child link="L2"/></joint>
                <link name="L2"/>
            </robot>
        `) as URDFRobot;

        compareRobots(robot, robot.clone());

        robot.name = 'RENOMBRADO';
        compareRobots(robot, robot.clone());
    });
});

describe('Material Tags', () => {
    it('debería parsear colores, transparencia y nombre de material (v0.184 compatibilidad)', () => {
        const loader = new URDFLoader();
        const res = loader.parse(`
            <robot name="TEST">
                <material name="Cyan"><color rgba="0 1.0 1.0 0.5"/></material>
                <link name="LINK">
                    <visual><geometry><box size="1 1 1"/></geometry><material name="Cyan"/></visual>
                </link>
            </robot>
        `);
        
        const material = (res.children[0].children[0] as any).material;
        expect(material.name).toEqual('Cyan');
        expect(material.transparent).toEqual(true);
        expect(material.depthWrite).toEqual(false);
        expect(material.opacity).toEqual(0.5);
    });
});

describe('Parsing Mimic Tags (Errores lógicos)', () => {
    it('debería detectar bucles infinitos en referencias cruzadas de mimic', () => {
        const loader = new URDFLoader();
        const urdf = `
            <robot name="TEST">
                <link name="L1"/><link name="L2"/><link name="L3"/>
                <joint name="A" type="continuous"><parent link="L1"/><child link="L2"/><mimic joint="B"/></joint>
                <joint name="B" type="continuous"><parent link="L2"/><child link="L3"/><mimic joint="A"/></joint>
            </robot>
        `;
        const robot = loader.parse(urdf) as URDFRobot;
        // El bucle de ejecución se excede al setear el valor debido a la referencia circular
        expect(() => robot.setJointValue('A', 10)).toThrowError(/Maximum call stack size exceeded/i);
    });

    it('debería usar por defecto multiplier 1 y offset 0 en articulaciones mímicas', () => {
        const loader = new URDFLoader();
        const res = loader.parse(`
            <robot name="TEST">
                <link name="L1"/><link name="L2"/><link name="L3"/>
                <joint name="A" type="continuous"><parent link="L1"/><child link="L2"/></joint>
                <joint name="B" type="continuous"><parent link="L2"/><child link="L3"/><mimic joint="A"/></joint>
            </robot>
        `);
        const jointB = res.joints['B'] as URDFMimicJoint;
        expect(jointB.multiplier).toEqual(1);
        expect(jointB.offset).toEqual(0);
    });
});

describe('Carga de Robot Local Completo (T12)', () => {
    it('debería parsear el archivo T12.URDF local y construir sus diccionarios de joints y links', () => {
        const loader = new URDFLoader();
        loader.packages = '/urdf';
        loader.loadMeshFunc = emptyLoadMeshFunc;

        const urdfPath = path.resolve(process.cwd(), 'urdf/T12/urdf/T12.URDF');
        const urdfContent = fs.readFileSync(urdfPath, 'utf8');

        const robot = loader.parse(urdfContent) as URDFRobot;

        expect(robot.isURDFRobot).toBe(true);
        expect(Object.keys(robot.links).length).toBeGreaterThan(0);
        expect(Object.keys(robot.joints).length).toBeGreaterThan(0);
        
        expect(robot.frames).toBeDefined();
    });
});