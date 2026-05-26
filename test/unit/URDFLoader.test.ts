import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mesh, Object3D } from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { URDFLoader } from '../../src/core/URDFLoader';
import { URDFRobot, URDFMimicJoint } from '../../src/core/URDFClasses';

// ==========================================
// FUNCIONES DE APOYO Y UTILIDADES
// ==========================================
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

// ==========================================
// TESTS ORIGINALES MANTENIDOS Y MEJORADOS
// ==========================================
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
            await new Promise(resolve => setTimeout(resolve, 5)); 
            
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
    it('debería parsear colores, transparencia y nombre de material', () => {
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
        expect(() => loader.parse(urdf)).toThrowError(/Detected an infinite loop of mimic joints/i);
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
    it('debería parsear el archivo T12.URDF local y construir sus diccionarios', () => {
        const loader = new URDFLoader();
        loader.packages = '/urdf';
        loader.loadMeshFunc = emptyLoadMeshFunc;

        const urdfPath = path.resolve(process.cwd(), 'urdf/T12/urdf/T12.URDF');
        const urdfContent = fs.readFileSync(urdfPath, 'utf8');

        const robot = loader.parse(urdfContent) as URDFRobot;

        expect(robot.isURDFRobot).toBe(true);
        expect(Object.keys(robot.links).length).toBeGreaterThan(0);
        expect(Object.keys(robot.joints).length).toBeGreaterThan(0);
    });
});

// ==========================================
// FASE 1 & 2: RED, API BOUNDARIES Y DOM
// ==========================================
describe('Fase 1 y 2: Ciclo de Vida de Red y Fronteras de API (Document/Element)', () => {
    let fetchSpy: any;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('debería procesar correctamente una instancia nativa de Document (pre-parseada)', () => {
        const loader = new URDFLoader();
        const mockURDF = `<robot name="DOMRobot"><link name="L1"/></robot>`;
        const xmlDoc = new DOMParser().parseFromString(mockURDF, 'text/xml');

        const robot = loader.parse(xmlDoc);
        expect(robot.robotName).toBe('DOMRobot');
        expect(Object.keys(robot.links)).toHaveLength(1);
    });

    it('debería procesar correctamente una instancia nativa de Element (nodo raíz)', () => {
        const loader = new URDFLoader();
        const mockURDF = `<robot name="ElementRobot"><link name="L1"/></robot>`;
        const xmlDoc = new DOMParser().parseFromString(mockURDF, 'text/xml');
        const rootElement = Array.from(xmlDoc.children).find(c => c.nodeName === 'robot') as Element;

        const robot = loader.parse(rootElement);
        expect(robot.robotName).toBe('ElementRobot');
    });

    it('debería realizar un fetch al endpoint en loadAsync y rechazar 404s', async () => {
        fetchSpy.mockResolvedValueOnce({
            ok: true, text: async () => `<robot name="NetworkRobot"><link name="Base"/></robot>`
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://fake-server.com/robot.urdf');
        
        expect(fetchSpy).toHaveBeenCalledWith('https://fake-server.com/robot.urdf', expect.any(Object));
        expect(robot.robotName).toBe('NetworkRobot');

        fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response);
        await expect(loader.loadAsync('https://fake-server.com/missing.urdf')).rejects.toThrowError(/Failed to load url/i);
    });
});

// ==========================================
// FASE 3: RESILIENCIA Y TOLERANCIA A FALLOS
// ==========================================
describe('Fase 3: Resiliencia a Fallos y Tolerancia de Mallas', () => {
    it('debería completar la instanciación estructural aunque una malla falle en descargarse (Fallo grácil)', async () => {
        const loader = new URDFLoader();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const urdf = `
            <robot name="ResilientRobot">
                <link name="Base">
                    <visual><geometry><mesh filename="broken_file.stl" /></geometry></visual>
                </link>
            </robot>
        `;

        // Simulamos un error catastrófico al cargar la malla
        loader.loadMeshFunc = async () => { throw new Error('Simulated Network Mesh Load Error'); };

        const robot = loader.parse(urdf);
        
        // Esperamos que se resuelva la microtarea del catch
        await new Promise(resolve => setTimeout(resolve, 10));

        // El robot sigue vivo y conserva su topología
        expect(robot.robotName).toBe('ResilientRobot');
        expect(Object.keys(robot.links)).toHaveLength(1);
        expect(consoleSpy).toHaveBeenCalledWith('URDFLoader: Error loading mesh.', expect.any(Error));

        consoleSpy.mockRestore();
    });

    it('debería ejecutar loadMeshFunc un número de veces exacto al número de mallas', async () => {
        const loader = new URDFLoader();
        let calls = 0;
        loader.loadMeshFunc = async () => { calls++; return new Mesh(); };

        const urdf = `
            <robot name="MultiMesh">
                <link name="L1">
                    <visual><geometry><mesh filename="1.stl"/></geometry></visual>
                    <visual><geometry><mesh filename="2.stl"/></geometry></visual>
                </link>
                <link name="L2">
                    <visual><geometry><mesh filename="3.stl"/></geometry></visual>
                </link>
            </robot>`;

        loader.parse(urdf);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(calls).toBe(3);
    });
});

// ==========================================
// FASE 4: INTEGRACIÓN A GRAN ESCALA
// ==========================================
describe('Fase 4: Pruebas de Estrés e Integración a Gran Escala', () => {
    let fetchSpy: any;

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Utilidad para simular cargas extremas sin pesados archivos físicos
    const generateLargeURDF = (name: string, linkCount: number) => {
        let xml = `<robot name="${name}">\n<link name="link_0"/>\n`;
        for(let i = 1; i < linkCount; i++) {
            xml += `<link name="link_${i}"/>\n`;
            xml += `<joint name="joint_${i}" type="continuous"><parent link="link_${i-1}"/><child link="link_${i}"/></joint>\n`;
        }
        xml += `</robot>`;
        return xml;
    };

    it('debería procesar estructuralmente un modelo masivo como NASA Robonaut (128 links, 127 joints)', async () => {
        fetchSpy.mockResolvedValue({
            ok: true, text: async () => generateLargeURDF('Robonaut_Mock', 128)
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://mock-nasa.gov/robonaut.urdf');

        expect(robot.robotName).toBe('Robonaut_Mock');
        expect(Object.keys(robot.links)).toHaveLength(128);
        expect(Object.keys(robot.joints)).toHaveLength(127);
    });

    it('debería procesar estructuralmente un modelo como NASA Valkyrie (69 links, 68 joints)', async () => {
        fetchSpy.mockResolvedValue({
            ok: true, text: async () => generateLargeURDF('Valkyrie_Mock', 69)
        } as Response);

        const loader = new URDFLoader();
        const robot = await loader.loadAsync('https://mock-nasa.gov/valkyrie.urdf');

        expect(robot.robotName).toBe('Valkyrie_Mock');
        expect(Object.keys(robot.links)).toHaveLength(69);
        expect(Object.keys(robot.joints)).toHaveLength(68);
    });

    it('debería resolver correctamente un robot multipaquete complejo (ROS Industrial)', async () => {
        const multiPkgUrdf = `
            <robot name="MultiPkg">
                <link name="Tool">
                    <visual><geometry><mesh filename="package://pkgA/mesh1.stl"/></geometry></visual>
                </link>
                <link name="Base">
                    <visual><geometry><mesh filename="package://pkgB/mesh2.stl"/></geometry></visual>
                </link>
            </robot>
        `;
        fetchSpy.mockResolvedValue({ ok: true, text: async () => multiPkgUrdf } as Response);

        const loader = new URDFLoader();
        loader.packages = {
            pkgA: 'https://ros-industrial.org/pkgA',
            pkgB: 'https://ros-industrial.org/pkgB'
        };

        const loadedUrls: string[] = [];
        loader.loadMeshFunc = async (url) => { loadedUrls.push(url); return new Mesh(); };

        await loader.loadAsync('https://mock.com/multipkg.urdf');
        await new Promise(resolve => setTimeout(resolve, 10)); // Vaciar event loop de promesas

        expect(loadedUrls).toContain('https://ros-industrial.org/pkgA/mesh1.stl');
        expect(loadedUrls).toContain('https://ros-industrial.org/pkgB/mesh2.stl');
    });
});