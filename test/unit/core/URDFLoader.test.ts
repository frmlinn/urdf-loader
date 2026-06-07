import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Mesh, Object3D, Material, TextureLoader, Texture, BufferGeometry, Group, MeshPhongMaterial, MeshBasicMaterial } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

import { URDFLoader } from '../../../src/core/URDFLoader';
import { URDFRobot, URDFVisual } from '../../../src/core/URDFClasses';
import { flushPromises, emptyLoadMeshFunc, compareRobots } from '../../utils/helpers';

describe('URDFLoader Module', () => {

    describe('Class: URDFLoader', () => {

        // =========================================================================
        // SECTION: parse()
        // Evaluates XML extraction, topological construction, and package resolution
        // =========================================================================
        describe('parse()', () => {
            
            it('should exclude geometric elements if configuration flags are false', () => {
                const urdfXML = `
                    <robot name="TEST">
                        <link name="LINK1">
                            <visual><geometry><box size="1 1 1"/></geometry></visual>
                            <collision><geometry><box size="1 1 1"/></geometry></collision>
                        </link>
                    </robot>
                `;
                const loader = new URDFLoader();
                loader.parseVisual = false;
                loader.parseCollision = false;
                const robot = loader.parse(urdfXML);
                
                let visTotal = 0; let colTotal = 0;
                robot.traverse(c => {
                    if ('isURDFCollider' in c) colTotal++;
                    if ('isURDFVisual' in c) visTotal++;
                });

                expect(visTotal).toBe(0);
                expect(colTotal).toBe(0);
            });

            it('should route paths using literal object maps', async () => {
                const urdf = `<robot name="TEST"><link name="L1"><visual><geometry><mesh filename="package://pkg1/path/model.stl" /></geometry></visual></link></robot>`;
                const loader = new URDFLoader();
                loader.packages = { 'pkg1': 'path/to/pkg1' };
                let loadedUrl = '';
                loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
                
                loader.parse(urdf);
                await flushPromises(); 
                expect(loadedUrl).toEqual('path/to/pkg1/path/model.stl');
            });

            it('should evaluate functional values to resolve paths dynamically', async () => {
                const urdf = `<robot name="TEST"><link name="L1"><visual><geometry><mesh filename="package://pkg1/path/model.stl" /></geometry></visual></link></robot>`;
                const loader = new URDFLoader();
                loader.packages = (pkg) => pkg === 'pkg1' ? 'func/path/1' : '';
                let loadedUrl = '';
                loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
                
                loader.parse(urdf);
                await flushPromises();
                expect(loadedUrl).toEqual('func/path/1/path/model.stl');
            });

            it('should gracefully fallback to null when providing an unsupported packages config type', async () => {
                const urdf = `<robot name="TEST"><link name="L1"><visual><geometry><mesh filename="package://pkg1/path/model.stl" /></geometry></visual></link></robot>`;
                const loader = new URDFLoader();
                loader.packages = 123 as unknown as string; 
                let loadedUrl = 'not-called';
                loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };
                
                loader.parse(urdf);
                await flushPromises(); 
                expect(loadedUrl).toEqual('not-called'); 
            });

            it('should evaluate relative working paths and string-based suffix resolution', async () => {
                const loader = new URDFLoader();
                loader.workingPath = 'http://base.com/';
                loader.packages = 'custom_dir/pkg1';
                
                const loadedUrls: string[] = [];
                loader.loadMeshFunc = async (url) => { loadedUrls.push(url); return new Mesh(); };
                
                loader.parse(`
                    <robot name="TEST">
                        <link name="L1"><visual><geometry><mesh filename="relative/model.stl"/></geometry></visual></link>
                        <link name="L2"><visual><geometry><mesh filename="package://pkg1/model2.stl"/></geometry></visual></link>
                    </robot>
                `);
                await flushPromises();
                
                expect(loadedUrls).toContain('http://base.com/relative/model.stl');
                expect(loadedUrls).toContain('custom_dir/pkg1/model2.stl');
            });

            it('should resolve paths correctly when packages string does NOT end with the target package', async () => {
                const loader = new URDFLoader();
                loader.packages = 'custom_base_dir'; 
                let loadedUrl = '';
                loader.loadMeshFunc = async (url) => { loadedUrl = url; return new Mesh(); };

                loader.parse(`<robot name="TEST"><link name="L1"><visual><geometry><mesh filename="package://pkg1/model.stl" /></geometry></visual></link></robot>`);
                await flushPromises();

                expect(loadedUrl).toEqual('custom_base_dir/pkg1/model.stl');
            });

            it('should log an error and return null when package is missing from the dictionary', () => {
                const loader = new URDFLoader();
                loader.packages = { 'known_pkg': '/path/' };
                const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                
                loader.parse(`<robot name="PkgErr"><link name="L1"><visual><geometry><mesh filename="package://unknown_pkg/mesh.stl"/></geometry></visual></link></robot>`);
                
                expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_pkg not found in provided package list'));
                consoleSpy.mockRestore();
            });

            it('should safely skip texture loading if the resolved material path is null', async () => {
                const loader = new URDFLoader();
                loader.packages = { 'valid_pkg': '/path/' };
                const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

                const urdf = `
                    <robot name="TexErr">
                        <link name="L1">
                            <visual>
                                <geometry><box size="1 1 1"/></geometry>
                                <material name="Mat1"><texture filename="package://broken_pkg/tex.png"/></material>
                            </visual>
                        </link>
                    </robot>
                `;
                const robot = loader.parse(urdf);
                await flushPromises();

                const visual = robot.links['L1'].children.find(c => c.type === 'URDFVisual') as URDFVisual;
                const mesh = visual.children[0] as Mesh;
                const material = mesh.material as MeshPhongMaterial;

                expect(material.map).toBeNull();
                expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('broken_pkg not found'));

                consoleSpy.mockRestore();
            });

            it('should parse inline visual materials, mesh scales, visual origins, and joint constraints', async () => {
                const loader = new URDFLoader();
                loader.loadMeshFunc = emptyLoadMeshFunc;
                
                const urdf = `
                    <robot name="FullParse">
                        <link name="L1">
                            <visual>
                                <origin xyz="1 2 3" rpy="0 1.570796 0"/>
                                <geometry><mesh filename="dummy.stl" scale="2 3 4"/></geometry>
                                <material><color rgba="1 0.5 0.2 1"/></material>
                            </visual>
                        </link>
                        <link name="L2"/>
                        <joint name="J1" type="revolute">
                            <origin xyz="4 5 6" rpy="0 0 1.570796"/>
                            <parent link="L1"/>
                            <child link="L2"/>
                            <limit effort="10" lower="-1" upper="1" velocity="5"/>
                        </joint>
                    </robot>
                `;
                
                const robot = loader.parse(urdf) as URDFRobot;
                await flushPromises();

                const joint = robot.joints['J1'];
                expect(joint.position.toArray()).toEqual([4, 5, 6]);
                expect(joint.rotation.z).toBeCloseTo(1.570796);
                expect(joint.limit.effort).toEqual(10);
                expect(joint.limit.upper).toEqual(1);

                const visual = robot.links['L1'].children.find(c => c.type === 'URDFVisual') as URDFVisual;
                expect(visual.position.toArray()).toEqual([1, 2, 3]);
                expect(visual.rotation.y).toBeCloseTo(1.570796);
                expect(visual.scale.toArray()).toEqual([2, 3, 4]);
                
                const mesh = visual.children[0] as Mesh;
                const material = mesh.material as MeshPhongMaterial;
                expect(material.color.r).toBeCloseTo(1);
            });

            it('should safely parse malformed XML, apply fallbacks for missing attributes, and ignore unknown tags', async () => {
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                const loader = new URDFLoader();
                const textureLoaderSpy = vi.spyOn(TextureLoader.prototype, 'load').mockReturnValue(new Texture());
                loader.loadMeshFunc = emptyLoadMeshFunc;
                
                const urdf = `
                    <robot name="ResilienceTest">
                        <material /> <link> <inertial>
                                <mass /> <inertia /> <dummy_tag /> </inertial>
                            <visual>
                                <origin /> <geometry><sphere /><capsule/></geometry> <material name="M1"><color /><shiny/></material> </visual>
                        </link>
                        <link name="L2">
                            <visual>
                                <geometry><cylinder /></geometry> <material name="M2"><texture /></material> </visual>
                        </link>
                        <joint type="revolute"> <parent link="" /> <child /> <limit /> </joint>
                    </robot>
                `;
                
                const robot = loader.parse(urdf);
                await flushPromises();

                expect(Object.keys(robot.joints)).toContain('');
                expect(Object.keys(robot.links)).toContain('');
                
                // Assert inertial and tuple fallbacks
                const emptyLink = robot.links[''];
                expect(emptyLink.inertial.mass).toBe(0);
                expect(emptyLink.inertial.inertia.ixx).toBe(0);
                
                const vis1 = emptyLink.children.find(c => c.type === 'URDFVisual') as URDFVisual;
                expect(vis1.position.toArray()).toEqual([0, 0, 0]); 
                
                // Assert geometry dimension fallbacks
                const sphereMesh = vis1.children[0] as Mesh;
                expect(sphereMesh.scale.toArray()).toEqual([0, 0, 0]); 
                expect((sphereMesh.material as MeshPhongMaterial).color.r).toBe(1); 

                // Assert joint limit fallbacks
                const joint = robot.joints[''];
                expect(joint.limit.lower).toBe(0);
                expect(joint.limit.upper).toBe(0);

                textureLoaderSpy.mockRestore();
                consoleErrorSpy.mockRestore();
            });

            it('should process collision elements without a name attribute without adding them to the colliders dictionary', () => {
                const loader = new URDFLoader();
                loader.parseCollision = true;
                
                const urdf = `
                    <robot name="AnonCol">
                        <link name="L1">
                            <collision><geometry><box size="1 1 1"/></geometry></collision>
                        </link>
                    </robot>
                `;
                const robot = loader.parse(urdf);

                const link = robot.links['L1'];
                const collision = link.children.find(c => c.type === 'URDFCollider');

                expect(collision).toBeDefined();
                expect(Object.keys(robot.colliders)).toHaveLength(0);
            });

            it('should skip mesh loading if the resolved file path is undefined or falsy', () => {
                const loader = new URDFLoader();
                loader.packages = { valid_pkg: '/path' };
                const loadMeshSpy = vi.spyOn(loader, 'loadMeshFunc');
                const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

                loader.parse(`<robot name="TEST"><link name="L"><visual><geometry><mesh filename="package://invalid_pkg/model.stl" /></geometry></visual></link></robot>`);

                expect(loadMeshSpy).not.toHaveBeenCalled();
                consoleSpy.mockRestore();
            });

            it('should skip mesh resolution entirely if the mesh tag lacks a filename attribute', () => {
                const loader = new URDFLoader();
                const loadMeshSpy = vi.spyOn(loader, 'loadMeshFunc');

                loader.parse(`<robot name="TEST"><link name="L"><visual><geometry><mesh /></geometry></visual></link></robot>`);

                expect(loadMeshSpy).not.toHaveBeenCalled();
            });

            it('should skip joint topology connection if parent or child link tags are missing', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="TEST">
                        <link name="L1"/>
                        <joint name="J1" type="continuous"><parent link="L1"/></joint>
                        <joint name="J2" type="continuous"><child link="L1"/></joint>
                        <joint name="J3" type="continuous"></joint>
                    </robot>
                `);
                
                expect(robot.joints['J1'].parent).toBeNull();
                expect(robot.joints['J2'].parent).toBeNull();
                expect(robot.joints['J3'].parent).toBeNull();
            });

            it('should correctly parse RGBA colors, transparency, and material names in global scope', () => {
                const loader = new URDFLoader();
                const res = loader.parse(`
                    <robot name="TEST">
                        <material name="Cyan"><color rgba="0 1.0 1.0 0.5"/></material>
                        <link name="LINK"><visual><geometry><box size="1 1 1"/></geometry><material name="Cyan"/></visual></link>
                    </robot>
                `);
                
                const material = (res.children[0].children[0] as Mesh).material as Material & { transparent: boolean, opacity: number };
                expect(material.name).toEqual('Cyan');
                expect(material.transparent).toEqual(true);
                expect(material.opacity).toEqual(0.5);
            });

            it('should safely ignore global material tags that lack a name attribute', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`<robot name="TEST"><material><color rgba="1 0 0 1"/></material></robot>`);
                
                expect(robot.robotName).toBe('TEST');
            });

            it('should properly instantiate box, sphere, cylinder geometries and apply textures', async () => {
                const loader = new URDFLoader();
                const textureLoaderSpy = vi.spyOn(TextureLoader.prototype, 'load').mockReturnValue(new Texture());
                
                const robot = loader.parse(`
                    <robot name="Primitives">
                        <material name="TexMat"><texture filename="dummy.png"/></material>
                        <link name="BoxLink"><visual name="BoxVis"><geometry><box size="1 2 3"/></geometry><material name="TexMat"/></visual></link>
                        <link name="SphereLink"><visual name="SphereVis"><geometry><sphere radius="5"/></geometry></visual></link>
                        <link name="CylLink"><visual name="CylVis"><geometry><cylinder radius="2" length="10"/></geometry></visual></link>
                        <joint name="J1" type="fixed"><parent link="BoxLink"/><child link="SphereLink"/></joint>
                    </robot>
                `);
                await flushPromises(); 
                
                const boxMesh = robot.visual['BoxVis'].children[0] as Mesh;
                expect(boxMesh.geometry.type).toBe('BoxGeometry');
                expect(boxMesh.scale.toArray()).toEqual([1, 2, 3]);
                expect((boxMesh.material as MeshPhongMaterial).map).toBeInstanceOf(Texture);
                
                const sphereMesh = robot.visual['SphereVis'].children[0] as Mesh;
                expect(sphereMesh.geometry.type).toBe('SphereGeometry');
                
                const cylMesh = robot.visual['CylVis'].children[0] as Mesh;
                expect(cylMesh.geometry.type).toBe('CylinderGeometry');

                textureLoaderSpy.mockRestore();
            });

            it('should safely ignore completely unsupported geometry types without crashing', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`<robot name="TEST"><link name="L"><visual><geometry><pyramid radius="1" length="2"/></geometry></visual></link></robot>`);
                
                const visual = robot.links['L'].children.find(c => c.type === 'URDFVisual') as URDFVisual;
                expect(visual.children.length).toBe(0);
            });

            it('should complete topological instantiation gracefully even if a mesh fetch fails', async () => {
                const loader = new URDFLoader();
                const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

                loader.loadMeshFunc = async () => { throw new Error('Simulated Network Mesh Load Error'); };

                const robot = loader.parse(`
                    <robot name="ResilientRobot">
                        <link name="Base"><visual><geometry><mesh filename="broken_file.stl" /></geometry></visual></link>
                    </robot>
                `);
                await flushPromises();

                expect(robot.robotName).toBe('ResilientRobot');
                expect(Object.keys(robot.links)).toHaveLength(1);
                expect(consoleSpy).toHaveBeenCalledWith('URDFLoader: Error loading mesh.', expect.any(Error));
                consoleSpy.mockRestore();
            });

            it('should explicitly cover all branches of the async mesh loading callback (Promises resolution)', async () => {
                const loader = new URDFLoader();
                
                let callCount = 0;
                loader.loadMeshFunc = async () => {
                    callCount++;
                    if (callCount === 1) return null; 
                    if (callCount === 2) return new Mesh();
                    
                    const group = new Group();
                    group.add(new Mesh());
                    group.add(new Object3D());
                    return group;
                };
                
                loader.parse(`
                    <robot name="AsyncCoverage">
                        <link name="L1"><visual><geometry><mesh filename="1.stl"/></geometry></visual></link>
                        <link name="L2"><visual><geometry><mesh filename="2.stl"/></geometry></visual></link>
                        <link name="L3"><visual><geometry><mesh filename="3.stl"/></geometry></visual></link>
                    </robot>
                `);
                
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(callCount).toBe(3);
            });

            it('should throw an error and abort when encountering infinite mimic loops', () => {
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

            it('should process a native pre-parsed XML Document instance', () => {
                const loader = new URDFLoader();
                const xmlDoc = new DOMParser().parseFromString(`<robot name="DOMRobot"><link name="L1"/></robot>`, 'text/xml');
                expect(loader.parse(xmlDoc).robotName).toBe('DOMRobot');
            });

            it('should process a native XML Element root node instance', () => {
                const loader = new URDFLoader();
                const xmlDoc = new DOMParser().parseFromString(`<robot name="ElementRobot"><link name="L1"/></robot>`, 'text/xml');
                const rootElement = Array.from(xmlDoc.children).find(c => c.nodeName === 'robot') as Element;
                expect(loader.parse(rootElement).robotName).toBe('ElementRobot');
            });

            it('should find the robot node if passed a parent Element containing it', () => {
                const loader = new URDFLoader();
                const xmlDoc = new DOMParser().parseFromString('<wrapper><robot name="WrappedBot"></robot></wrapper>', 'text/xml');
                expect(loader.parse(xmlDoc.documentElement).robotName).toBe('WrappedBot');
            });

            it('should throw an error if no <robot> node is found in the URDF content', () => {
                const loader = new URDFLoader();
                expect(() => loader.parse('<not_a_robot></not_a_robot>')).toThrow(/No <robot> node found/);
            });
        });

        // =========================================================================
        // SECTION: load() & loadAsync()
        // Evaluates Network Fetch, Callback Invocation, and Stress parsing
        // =========================================================================
        describe('load() & loadAsync()', () => {
            let fetchSpy: MockInstance;

            beforeEach(() => {
                fetchSpy = vi.spyOn(global, 'fetch');
            });

            afterEach(() => {
                vi.restoreAllMocks();
            });

            it('should successfully fetch, parse, and invoke optional callbacks', async () => {
                fetchSpy.mockResolvedValueOnce({
                    ok: true, text: async () => `<robot name="NetworkRobot"><link name="Base"/></robot>`
                } as unknown as Response);

                const loader = new URDFLoader();
                const progressSpy = vi.fn();
                
                await new Promise<void>(resolve => {
                    loader.load('https://fake.com/robot.urdf', () => resolve(), progressSpy);
                });
                
                expect(progressSpy).toHaveBeenCalled();
                expect(fetchSpy).toHaveBeenCalled();
            });

            it('should safely execute loadAsync resolving the payload without explicit callbacks', async () => {
                fetchSpy.mockResolvedValueOnce({
                    ok: true, text: async () => `<robot name="NoCallback"><link name="L1"/></robot>`
                } as unknown as Response);

                const loader = new URDFLoader();
                const robot = await loader.loadAsync('https://fake.com/robot.urdf');
                expect(robot.robotName).toEqual('NoCallback');
            });

            it('should gracefully handle 404 network rejections and invoke error callbacks', async () => {
                fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as unknown as Response);
                const loader = new URDFLoader();
                
                await expect(loader.loadAsync('https://fake-server.com/missing.urdf')).rejects.toThrowError(/Failed to load url/i);
            });

            it('should fallback to console.error when load fails and no onError callback is provided', async () => {
                fetchSpy.mockRejectedValueOnce(new Error('Network Fail'));
                const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
                
                const loader = new URDFLoader();
                loader.load('fail.urdf');
                
                await flushPromises();
                expect(consoleSpy).toHaveBeenCalledWith('URDFLoader: Error loading file.', expect.any(Error));
                consoleSpy.mockRestore();
            });

            it('should process a massive model structure (128 links, 127 joints) without overflowing the stack', async () => {
                const generateLargeURDF = (name: string, linkCount: number) => {
                    let xml = `<robot name="${name}">\n<link name="link_0"/>\n`;
                    for(let i = 1; i < linkCount; i++) {
                        xml += `<link name="link_${i}"/>\n`;
                        xml += `<joint name="joint_${i}" type="continuous"><parent link="link_${i-1}"/><child link="link_${i}"/></joint>\n`;
                    }
                    xml += `</robot>`;
                    return xml;
                };

                fetchSpy.mockResolvedValue({
                    ok: true, text: async () => generateLargeURDF('Robonaut_Mock', 128)
                } as unknown as Response);

                const loader = new URDFLoader();
                const robot = await loader.loadAsync('https://mock-nasa.gov/robonaut.urdf');

                expect(robot.robotName).toBe('Robonaut_Mock');
                expect(Object.keys(robot.links)).toHaveLength(128);
                expect(Object.keys(robot.joints)).toHaveLength(127);
            });

            it('should correctly resolve a complex multi-package ROS Industrial robot string', async () => {
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
                fetchSpy.mockResolvedValue({ ok: true, text: async () => multiPkgUrdf } as unknown as Response);

                const loader = new URDFLoader();
                loader.packages = {
                    pkgA: 'https://ros-industrial.org/pkgA',
                    pkgB: 'https://ros-industrial.org/pkgB'
                };

                const loadedUrls: string[] = [];
                loader.loadMeshFunc = async (url) => { loadedUrls.push(url); return new Mesh(); };

                await loader.loadAsync('https://mock.com/multipkg.urdf');
                await flushPromises();

                expect(loadedUrls).toContain('https://ros-industrial.org/pkgA/mesh1.stl');
                expect(loadedUrls).toContain('https://ros-industrial.org/pkgB/mesh2.stl');
            });

            it('should execute load() successfully even if the onLoad callback is omitted', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true, text: async () => `<robot name="NoCallback"></robot>`
            } as unknown as Response);

            const loader = new URDFLoader();
            loader.load('https://fake.com/robot.urdf'); 
            await flushPromises();

            expect(fetchSpy).toHaveBeenCalled();
        });
        });

        // =========================================================================
        // SECTION: defaultMeshLoader()
        // Evaluates internal extension routing and geometric bounding defaults
        // =========================================================================
        describe('defaultMeshLoader()', () => {

            it('should route to STLLoader for .stl extensions and generate a mesh with bounding volumes', async () => {
                const loader = new URDFLoader();
                const stlLoadSpy = vi.spyOn(STLLoader.prototype, 'loadAsync').mockResolvedValue(new BufferGeometry());
                
                const result = await loader.defaultMeshLoader('model.stl', loader.manager) as Mesh;
                
                expect(stlLoadSpy).toHaveBeenCalledWith('model.stl');
                expect(result.geometry.type).toBe('BufferGeometry');
                
                stlLoadSpy.mockRestore();
            });

            it('should safely handle STLLoader returning null or geometry with existing bounding volumes', async () => {
                const loader = new URDFLoader();
                const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
                const stlLoadSpy = vi.spyOn(STLLoader.prototype, 'loadAsync').mockResolvedValueOnce(null as unknown as BufferGeometry);
                
                const res1 = await loader.defaultMeshLoader('empty.stl', loader.manager);
                expect(res1).toBeNull();

                const geom = new BufferGeometry();
                geom.computeBoundingBox();
                geom.computeBoundingSphere();
                const computeBoxSpy = vi.spyOn(geom, 'computeBoundingBox');
                
                stlLoadSpy.mockResolvedValueOnce(geom);
                const res2 = await loader.defaultMeshLoader('bounded.stl', loader.manager) as Mesh;
                
                expect(computeBoxSpy).not.toHaveBeenCalled();
                expect(res2.geometry).toBe(geom);

                stlLoadSpy.mockRestore();
                consoleSpy.mockRestore();
            });

            it('should route to ColladaLoader for .dae extensions and extract the parsed scene', async () => {
                const loader = new URDFLoader();
                const dummyScene = new Group();
                dummyScene.add(new Mesh(new BufferGeometry()));

                const daeLoadSpy = vi.spyOn(ColladaLoader.prototype, 'loadAsync').mockResolvedValue({ scene: dummyScene } as unknown as never);
                const result = await loader.defaultMeshLoader('model.dae', loader.manager);
                
                expect(daeLoadSpy).toHaveBeenCalledWith('model.dae');
                expect(result).toBe(dummyScene);
                
                daeLoadSpy.mockRestore();
            });

            it('should safely handle ColladaLoader returning missing scenes or meshes with existing bounding volumes', async () => {
                const loader = new URDFLoader();
                const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                const daeLoadSpy = vi.spyOn(ColladaLoader.prototype, 'loadAsync').mockResolvedValueOnce({} as unknown as never);
                const res1 = await loader.defaultMeshLoader('noscene.dae', loader.manager);
                expect(res1).toBeNull();

                const geom = new BufferGeometry();
                geom.computeBoundingBox();
                geom.computeBoundingSphere();
                const computeSphereSpy = vi.spyOn(geom, 'computeBoundingSphere');
                
                const group = new Group();
                group.add(new Mesh(geom, new MeshBasicMaterial()));

                daeLoadSpy.mockResolvedValueOnce({ scene: group } as unknown as never);
                const res2 = await loader.defaultMeshLoader('bounded.dae', loader.manager);
                
                expect(computeSphereSpy).not.toHaveBeenCalled();
                expect(res2).toBe(group);

                daeLoadSpy.mockRestore();
                consoleSpy.mockRestore();
            });

            it('should log a warning and return null for unsupported mesh extensions', async () => {
                const loader = new URDFLoader();
                const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
                
                const result = await loader.defaultMeshLoader('model.obj', loader.manager);
                
                expect(result).toBeNull();
                expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No loader available for extension .obj'));
                
                consoleSpy.mockRestore();
            });
        });

        // =========================================================================
        // SECTION: Robot cloning capabilities (Generated internally by loader)
        // =========================================================================
        describe('URDFRobot Output Verification', () => {
            it('should clone an URDF robot structure accurately even after renaming', () => {
                const loader = new URDFLoader();
                const robot = loader.parse(`
                    <robot name="ORIGINAL">
                        <link name="L1"/>
                        <joint name="J1" type="continuous"><parent link="L1"/><child link="L2"/></joint>
                        <link name="L2"/>
                    </robot>
                `) as URDFRobot;
        
                compareRobots(robot, robot.clone());
        
                robot.name = 'RENAMED';
                compareRobots(robot, robot.clone());
            });
        });
    });
});