import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

import { URDFRobot, URDFJoint, URDFLink, URDFCollider, URDFVisual, URDFMimicJoint, URDFBase, JointType, retainMeshResources } from './URDFClasses';

/** Signature for a custom mesh loading function replacing the default implementation. */
export type MeshLoadFunc = (path: string, manager: THREE.LoadingManager) => Promise<THREE.Object3D | null>;

/** Configures how `package://` URLs are resolved within the URDF loader. */
export type PackagesConfig = string | Record<string, string> | ((targetPkg: string) => string);

/**
 * Main parser and loader class for URDF (Unified Robot Description Format) files.
 * Extends THREE.Loader integrating seamlessly with the Three.js ecosystem.
 */
export class URDFLoader extends THREE.Loader {
    /** Injected handler for loading 3D mesh files like STL or DAE. */
    public loadMeshFunc: MeshLoadFunc;
    /** If true, parses `<visual>` blocks and generates 3D geometries. */
    public parseVisual: boolean = true;
    /** If true, parses `<collision>` blocks and generates geometric colliders. */
    public parseCollision: boolean = false;
    /** Package resolution definition map. */
    public packages: PackagesConfig = '';
    /** Explicit base path replacing standard URL extraction. */
    public workingPath: string = '';
    /** Custom standard HTTP request parameters. */
    public fetchOptions: RequestInit = {};

    constructor(manager?: THREE.LoadingManager) {
        super(manager);
        this.loadMeshFunc = this.defaultMeshLoader.bind(this);
    }

    public override load(
        url: string,
        onLoad?: (data: URDFRobot) => void,
        onProgress?: (event: ProgressEvent) => void,
        onError?: (err: unknown) => void
    ): void {
        const workingPath = THREE.LoaderUtils.extractUrlBase(url);
        const urdfPath = this.manager.resolveURL(url);

        this.manager.itemStart(urdfPath);

        fetch(urdfPath, this.fetchOptions)
            .then(res => {
                if (!res.ok) throw new Error(`URDFLoader: Failed to load url '${urdfPath}' with error code ${res.status} : ${res.statusText}.`);
                if (onProgress) onProgress(new ProgressEvent('progress'));
                return res.text();
            })
            .then(data => {
                const model = this.parse(data, this.workingPath || workingPath);
                if (onLoad) onLoad(model);
                this.manager.itemEnd(urdfPath);
            })
            .catch(e => {
                if (onError) onError(e);
                else console.error('URDFLoader: Error loading file.', e);
                this.manager.itemError(urdfPath);
                this.manager.itemEnd(urdfPath);
            });
    }

    public override loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<URDFRobot> {
        return new Promise((resolve, reject) => {
            this.load(url, resolve, onProgress, reject);
        });
    }

    /**
     * Parses the raw XML string or DOM into a standardized URDFRobot structure.
     * * @param content - XML String or Document/Element to parse.
     * @param workingPath - Directory base to resolve dependencies.
     * @returns Fully configured URDFRobot.
     */
    public parse(content: string | Document | Element, workingPath: string = this.workingPath): URDFRobot {
        const linkMap: Record<string, URDFLink> = {};
        const jointMap: Record<string, URDFJoint> = {};
        const materialMap: Record<string, THREE.Material> = {};

        const resolvePath = (path: string): string | null => {
            if (!/^package:\/\//.test(path)) {
                return workingPath ? workingPath + path : path;
            }

            const [targetPkg, relPath] = path.replace(/^package:\/\//, '').split(/\/(.+)/);

            if (typeof this.packages === 'string') {
                return this.packages.endsWith(targetPkg) ? `${this.packages}/${relPath}` : `${this.packages}/${targetPkg}/${relPath}`;
            } else if (typeof this.packages === 'function') {
                return `${this.packages(targetPkg)}/${relPath}`;
            } else if (typeof this.packages === 'object' && this.packages !== null) {
                if (targetPkg in this.packages) return `${this.packages[targetPkg]}/${relPath}`;
                console.error(`URDFLoader: ${targetPkg} not found in provided package list.`);
                return null;
            }
            return null;
        };

        const processTuple = (val: string | null): [number, number, number] => {
            if (!val) return [0, 0, 0];
            const parsed = val.trim().split(/\s+/g).map(parseFloat);
            return [parsed[0] || 0, parsed[1] || 0, parsed[2] || 0];
        };

        const applyRotation = (obj: THREE.Object3D, rpy: [number, number, number]) => {
            obj.rotation.set(0, 0, 0);
            const tempEuler = new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX');
            const tempQuaternion = new THREE.Quaternion().setFromEuler(tempEuler);
            tempQuaternion.multiply(obj.quaternion);
            obj.quaternion.copy(tempQuaternion);
        };

        const processMaterial = (node: Element): THREE.Material => {
            const material = new THREE.MeshPhongMaterial();
            material.name = node.getAttribute('name') || '';

            Array.from(node.children).forEach(n => {
                const type = n.nodeName.toLowerCase();
                if (type === 'color') {
                    const rgba = n.getAttribute('rgba')?.split(/\s/g).map(parseFloat) || [1, 1, 1, 1];
                    material.color.setRGB(rgba[0], rgba[1], rgba[2]);
                    material.opacity = rgba[3];
                    material.transparent = rgba[3] < 1;
                    material.depthWrite = !material.transparent;
                } else if (type === 'texture') {
                    const filename = n.getAttribute('filename');
                    if (filename) {
                        const loader = new THREE.TextureLoader(this.manager);
                        const filePath = resolvePath(filename);
                        if (filePath) {
                            material.map = loader.load(filePath);
                            material.map.colorSpace = THREE.SRGBColorSpace;
                        }
                    }
                }
            });
            return material;
        };

        const processLinkElement = (vn: Element, matMap: Record<string, THREE.Material> = {}): URDFBase => {
            const isCollisionNode = vn.nodeName.toLowerCase() === 'collision';
            const group: URDFBase = isCollisionNode ? new URDFCollider() : new URDFVisual();
            group.urdfNode = vn;

            let material: THREE.Material = new THREE.MeshPhongMaterial();
            const materialNode = Array.from(vn.children).find(n => n.nodeName.toLowerCase() === 'material');
            
            if (materialNode) {
                const name = materialNode.getAttribute('name');
                if (name && name in matMap) {
                    material = matMap[name];
                } else {
                    material = processMaterial(materialNode);
                }
            }

            Array.from(vn.children).forEach(n => {
                const type = n.nodeName.toLowerCase();
                if (type === 'geometry' && n.children[0]) {
                    const geoNode = n.children[0];
                    const geoType = geoNode.nodeName.toLowerCase();

                    if (geoType === 'mesh') {
                        const filename = geoNode.getAttribute('filename');
                        if (filename) {
                            const filePath = resolvePath(filename);
                            if (filePath !== null) {
                                const scaleAttr = geoNode.getAttribute('scale');
                                if (scaleAttr) {
                                    const scale = processTuple(scaleAttr);
                                    group.scale.set(scale[0], scale[1], scale[2]);
                                }

                                this.loadMeshFunc(filePath, this.manager).then(obj => {
                                    if (obj) {
                                        if (obj instanceof THREE.Mesh) obj.material = material;
                                        obj.position.set(0, 0, 0);
                                        obj.quaternion.identity();
                                        
                                        // Retain resources for async remote meshes
                                        obj.traverse(c => {
                                            if (c instanceof THREE.Mesh) retainMeshResources(c);
                                        });

                                        group.add(obj);
                                    }
                                }).catch(err => console.error('URDFLoader: Error loading mesh.', err));
                            }
                        }
                    } else if (geoType === 'box') {
                        const size = processTuple(geoNode.getAttribute('size'));
                        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
                        mesh.scale.set(size[0], size[1], size[2]);
                        retainMeshResources(mesh);
                        group.add(mesh);
                    } else if (geoType === 'sphere') {
                        const radius = parseFloat(geoNode.getAttribute('radius') || '0');
                        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 30), material);
                        mesh.scale.set(radius, radius, radius);
                        retainMeshResources(mesh);
                        group.add(mesh);
                    } else if (geoType === 'cylinder') {
                        const radius = parseFloat(geoNode.getAttribute('radius') || '0');
                        const length = parseFloat(geoNode.getAttribute('length') || '0');
                        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 30), material);
                        mesh.scale.set(radius, length, radius);
                        mesh.rotation.set(Math.PI / 2, 0, 0);
                        retainMeshResources(mesh);
                        group.add(mesh);
                    }
                } else if (type === 'origin') {
                    const xyz = processTuple(n.getAttribute('xyz'));
                    const rpy = processTuple(n.getAttribute('rpy'));
                    group.position.set(xyz[0], xyz[1], xyz[2]);
                    group.rotation.set(0, 0, 0);
                    applyRotation(group, rpy);
                }
            });

            return group;
        };

        const processLink = (link: Element, isRoot: boolean, robotObj: URDFRobot): URDFLink => {
            const target = isRoot ? robotObj : new URDFLink();
            target.name = link.getAttribute('name') || '';
            target.urdfName = target.name;
            target.urdfNode = link;

            const inertialNode = Array.from(link.children).find(n => n.nodeName.toLowerCase() === 'inertial');
            if (inertialNode) {
                Array.from(inertialNode.children).forEach(n => {
                    const type = n.nodeName.toLowerCase();
                    if (type === 'origin') {
                        target.inertial.origin.xyz = processTuple(n.getAttribute('xyz'));
                        target.inertial.origin.rpy = processTuple(n.getAttribute('rpy'));
                    } else if (type === 'mass') {
                        target.inertial.mass = parseFloat(n.getAttribute('value') || '0');
                    } else if (type === 'inertia') {
                        target.inertial.inertia.ixx = parseFloat(n.getAttribute('ixx') || '0');
                        target.inertial.inertia.ixy = parseFloat(n.getAttribute('ixy') || '0');
                        target.inertial.inertia.ixz = parseFloat(n.getAttribute('ixz') || '0');
                        target.inertial.inertia.iyy = parseFloat(n.getAttribute('iyy') || '0');
                        target.inertial.inertia.iyz = parseFloat(n.getAttribute('iyz') || '0');
                        target.inertial.inertia.izz = parseFloat(n.getAttribute('izz') || '0');
                    }
                });
            }

            if (this.parseVisual) {
                Array.from(link.children).filter(n => n.nodeName.toLowerCase() === 'visual').forEach(vn => {
                    const v = processLinkElement(vn, materialMap) as URDFVisual;
                    target.add(v);
                    if (vn.hasAttribute('name')) {
                        const name = vn.getAttribute('name') as string;
                        v.name = name;
                        v.urdfName = name;
                        robotObj.visual[name] = v;
                    }
                });
            }

            if (this.parseCollision) {
                Array.from(link.children).filter(n => n.nodeName.toLowerCase() === 'collision').forEach(cn => {
                    const c = processLinkElement(cn) as URDFCollider;
                    target.add(c);
                    if (cn.hasAttribute('name')) {
                        const name = cn.getAttribute('name') as string;
                        c.name = name;
                        c.urdfName = name;
                        robotObj.colliders[name] = c;
                    }
                });
            }

            return target;
        };

        const processJoint = (joint: Element): URDFJoint => {
            const mimicTag = Array.from(joint.children).find(n => n.nodeName.toLowerCase() === 'mimic');
            let obj: URDFJoint;

            if (mimicTag) {
                obj = new URDFMimicJoint();
                (obj as URDFMimicJoint).mimicJoint = mimicTag.getAttribute('joint');
                (obj as URDFMimicJoint).multiplier = parseFloat(mimicTag.getAttribute('multiplier') || '1.0');
                (obj as URDFMimicJoint).offset = parseFloat(mimicTag.getAttribute('offset') || '0.0');
            } else {
                obj = new URDFJoint();
            }

            obj.urdfNode = joint;
            obj.name = joint.getAttribute('name') || '';
            obj.urdfName = obj.name;
            obj.jointType = (joint.getAttribute('type') as JointType) || 'fixed';

            let parent: URDFLink | null = null;
            let child: URDFLink | null = null;
            let xyz: [number, number, number] = [0, 0, 0];
            let rpy: [number, number, number] = [0, 0, 0];

            for (const n of Array.from(joint.children)) {
                const type = n.nodeName.toLowerCase();
                if (type === 'origin') {
                    xyz = processTuple(n.getAttribute('xyz'));
                    rpy = processTuple(n.getAttribute('rpy'));
                } else if (type === 'child') {
                    child = linkMap[n.getAttribute('link') || ''];
                } else if (type === 'parent') {
                    parent = linkMap[n.getAttribute('link') || ''];
                } else if (type === 'limit') {
                    obj.limit.lower = parseFloat(n.getAttribute('lower') || String(obj.limit.lower));
                    obj.limit.upper = parseFloat(n.getAttribute('upper') || String(obj.limit.upper));
                    obj.limit.effort = parseFloat(n.getAttribute('effort') || String(obj.limit.effort));
                    obj.limit.velocity = parseFloat(n.getAttribute('velocity') || String(obj.limit.velocity));
                }
            }

            if (parent && child) {
                parent.add(obj);
                obj.add(child);
            }

            applyRotation(obj, rpy);
            obj.position.set(xyz[0], xyz[1], xyz[2]);

            const axisNode = Array.from(joint.children).find(n => n.nodeName.toLowerCase() === 'axis');
            if (axisNode) {
                const axisXYZ = processTuple(axisNode.getAttribute('xyz'));
                obj.axis.set(axisXYZ[0], axisXYZ[1], axisXYZ[2]).normalize();
            }

            return obj;
        };

        const processRobot = (robot: Element): URDFRobot => {
            const obj = new URDFRobot();
            obj.robotName = robot.getAttribute('name');
            obj.urdfRobotNode = robot;

            Array.from(robot.children).filter(c => c.nodeName.toLowerCase() === 'material').forEach(m => {
                const name = m.getAttribute('name');
                if (name) materialMap[name] = processMaterial(m);
            });

            Array.from(robot.children).filter(c => c.nodeName.toLowerCase() === 'link').forEach(l => {
                const name = l.getAttribute('name') || '';
                const isRoot = robot.querySelector(`child[link="${name}"]`) === null;
                linkMap[name] = processLink(l, isRoot, obj);
            });

            Array.from(robot.children).filter(c => c.nodeName.toLowerCase() === 'joint').forEach(j => {
                const name = j.getAttribute('name') || '';
                jointMap[name] = processJoint(j);
            });

            obj.joints = jointMap;
            obj.links = linkMap;

            Object.values(jointMap).forEach(j => {
                if (j instanceof URDFMimicJoint && j.mimicJoint && jointMap[j.mimicJoint]) {
                    jointMap[j.mimicJoint].mimicJoints.push(j);
                }
            });

            Object.values(jointMap).forEach(j => {
                const uniqueJoints = new Set<URDFJoint>();
                const iterFunction = (joint: URDFJoint) => {
                    if (uniqueJoints.has(joint)) {
                        throw new Error('URDFLoader: Detected an infinite loop of mimic joints.');
                    }
                    uniqueJoints.add(joint);
                    joint.mimicJoints.forEach(mj => iterFunction(mj));
                };
                iterFunction(j);
            });

            obj.frames = { ...obj.colliders, ...obj.visual, ...linkMap, ...jointMap };
            return obj;
        };

        let robotNode: Element | undefined;
        if (content instanceof Document) {
            robotNode = Array.from(content.children).find(c => c.nodeName === 'robot');
        } else if (content instanceof Element) {
            robotNode = content.nodeName === 'robot' ? content : Array.from(content.children).find(c => c.nodeName === 'robot');
        } else {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(content, 'text/xml');
            robotNode = Array.from(xmlDoc.children).find(c => c.nodeName === 'robot');
        }

        if (!robotNode) throw new Error('URDFLoader: No <robot> node found in URDF content.');
        return processRobot(robotNode);
    }

    /**
     * Default callback applied to fetch and parse external meshes (DAE/STL).
     * @param path - URL to load the mesh from.
     * @param manager - Global Three.js LoadingManager context.
     * @returns A promise resolving to the fully constructed Object3D.
     */
    public async defaultMeshLoader(path: string, manager: THREE.LoadingManager): Promise<THREE.Object3D | null> {
        const ext = path.split('.').pop()?.toLowerCase();

        if (ext === 'stl') {
            const loader = new STLLoader(manager);
            const geom = await loader.loadAsync(path) as THREE.BufferGeometry;
            if (geom) {
                if (!geom.boundingSphere) geom.computeBoundingSphere();
                if (!geom.boundingBox) geom.computeBoundingBox();
                
                return new THREE.Mesh(geom, new THREE.MeshPhongMaterial());
            }
        } else if (ext === 'dae') {
            const loader = new ColladaLoader(manager);
            const dae = await loader.loadAsync(path) as unknown as { scene: THREE.Group };
            if (dae && dae.scene) {
                dae.scene.traverse((c) => {
                    if (c instanceof THREE.Mesh && c.geometry) {
                        if (!c.geometry.boundingSphere) c.geometry.computeBoundingSphere();
                        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                    }
                });
                return dae.scene;
            }
        }

        console.warn(`URDFLoader: Could not load model at ${path}.\nNo loader available for extension .${ext} or loading failed.`);
        return null;
    }
}