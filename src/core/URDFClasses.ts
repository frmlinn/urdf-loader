import { Euler, Object3D, Vector3, Quaternion, Matrix4, Mesh, Material, Texture } from 'three';

// Pre-allocated objects for zero-garbage collection mathematical operations
const _tempAxis = new Vector3();
const _tempEuler = new Euler();
const _tempTransform = new Matrix4();
const _tempOrigTransform = new Matrix4();
const _tempQuat = new Quaternion();
const _tempScale = new Vector3(1.0, 1.0, 1.0);
const _tempPosition = new Vector3();

// --- MEMORY MANAGEMENT SYSTEM (REFERENCE COUNTING) ---

/**
 * Increments the reference count of a given resource or array of resources.
 * Initializes the reference count if it does not exist.
 * * @param res - The Three.js resource (or array of resources) to retain.
 */
export function retainResource(res: unknown): void {
    if (!res) return;
    if (Array.isArray(res)) {
        res.forEach(retainResource);
        return;
    }
    const obj = res as { userData?: { refCount?: number } };
    obj.userData = obj.userData || {};
    obj.userData.refCount = (obj.userData.refCount || 0) + 1;
}

/**
 * Decrements the reference count of a resource. Disposes of the resource
 * if the reference count reaches zero.
 * * @param res - The Three.js resource (or array of resources) to release.
 */
export function releaseResource(res: unknown): void {
    if (!res) return;
    if (Array.isArray(res)) {
        res.forEach(releaseResource);
        return;
    }
    const obj = res as { userData?: { refCount?: number }, dispose?: () => void };
    if (obj.userData && typeof obj.userData.refCount === 'number') {
        obj.userData.refCount--;
        if (obj.userData.refCount <= 0) {
            if (typeof obj.dispose === 'function') obj.dispose();
            delete obj.userData.refCount;
        }
    }
}

/**
 * Retains all geometry and material resources associated with a given mesh.
 * * @param mesh - The mesh whose resources will be retained.
 */
export function retainMeshResources(mesh: Mesh): void {
    if (mesh.geometry) retainResource(mesh.geometry);
    if (mesh.material) {
        retainResource(mesh.material);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
            const matWithMap = m as Material & { map?: Texture | null };
            if (matWithMap.map) retainResource(matWithMap.map);
        });
    }
}
/**
 * Releases all geometry and material resources associated with a given mesh.
 * * @param mesh - The mesh whose resources will be released.
 */
export function releaseMeshResources(mesh: Mesh): void {
    if (mesh.geometry) releaseResource(mesh.geometry);
    if (mesh.material) {
        releaseResource(mesh.material);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
            const matWithMap = m as Material & { map?: Texture | null };
            if (matWithMap.map) releaseResource(matWithMap.map);
        });
    }
}

// --- CORE CLASSES ---

/** Limits applied to a joint's movement. */
export interface JointLimits {
    lower: number;
    upper: number;
    effort: number;
    velocity: number;
}

/** Origin parameters for inertial properties. */
export interface InertialOrigin {
    xyz: [number, number, number];
    rpy: [number, number, number];
}

/** Inertia tensor matrix components. */
export interface InertiaMatrix {
    ixx: number; ixy: number; ixz: number;
    iyy: number; iyz: number; izz: number;
}

/** Defines the mass and inertial properties of a link. */
export interface InertialProperties {
    mass: number;
    origin: InertialOrigin;
    inertia: InertiaMatrix;
}

/** Available types of URDF joints. */
export type JointType = 'fixed' | 'continuous' | 'revolute' | 'prismatic' | 'planar' | 'floating';

/**
 * Base class for all URDF elements mapped to Three.js Object3D.
 */
export class URDFBase extends Object3D {
    /** The original DOM element parsed from the URDF file. */
    public urdfNode: Element | null = null;
    /** The standard name of the URDF element. */
    public urdfName: string = '';

    constructor() {
        super();
    }

    override copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive);
        this.urdfNode = source.urdfNode;
        this.urdfName = source.urdfName;
        return this;
    }
}

/** Represents a collision geometry in a URDF model. */
export class URDFCollider extends URDFBase {
    public readonly isURDFCollider = true;
    override type = 'URDFCollider';
}

/** Represents a visual geometry in a URDF model. */
export class URDFVisual extends URDFBase {
    public readonly isURDFVisual = true;
    override type = 'URDFVisual';
}

/** Represents a rigid body link in a URDF model. */
export class URDFLink extends URDFBase {
    public readonly isURDFLink = true;
    override type = 'URDFLink';
    
    public inertial: InertialProperties = {
        mass: 0,
        origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    };

    override copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive);
        this.inertial = {
            mass: source.inertial.mass,
            origin: {
                xyz: [...source.inertial.origin.xyz],
                rpy: [...source.inertial.origin.rpy],
            },
            inertia: { ...source.inertial.inertia },
        };
        return this;
    }
}

/** Represents a kinematic joint connecting two URDF links. */
export class URDFJoint extends URDFBase {
    public readonly isURDFJoint = true;
    override type = 'URDFJoint';

    private _jointType: JointType = 'fixed';
    
    /** Current state values of the joint. Length depends on the joint type. */
    public jointValue: number[] = [];
    /** The axis of motion for the joint. */
    public axis = new Vector3(1, 0, 0);
    /** Kinematic and dynamic limits. */
    public limit: JointLimits = { lower: 0, upper: 0, effort: 0, velocity: 0 };
    /** Disables limit checking if true. */
    public ignoreLimits = false;

    /** Original local position before any transformations. */
    public origPosition: Vector3 | null = null;
    /** Original local rotation before any transformations. */
    public origQuaternion: Quaternion | null = null;
    /** Array of joints constrained to mimic this joint. */
    public mimicJoints: URDFMimicJoint[] = [];

    get jointType(): JointType {
        return this._jointType;
    }

    set jointType(v: JointType) {
        if (this._jointType === v) return;
        this._jointType = v;
        this.matrixWorldNeedsUpdate = true;

        switch (v) {
            case 'fixed':
                this.jointValue = [];
                break;
            case 'continuous':
            case 'revolute':
            case 'prismatic':
                this.jointValue = new Array(1).fill(0);
                break;
            case 'planar':
                this.jointValue = new Array(3).fill(0);
                this.axis.set(0, 0, 1);
                break;
            case 'floating':
                this.jointValue = new Array(6).fill(0);
                break;
        }
    }

    /** Returns the primary angle or displacement value. */
    get angle(): number {
        return this.jointValue[0] || 0;
    }

    override copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive);
        this.jointType = source.jointType;
        this.axis.copy(source.axis);
        this.limit = { ...source.limit };
        this.ignoreLimits = source.ignoreLimits;
        this.jointValue = [...source.jointValue];

        this.origPosition = source.origPosition ? source.origPosition.clone() : null;
        this.origQuaternion = source.origQuaternion ? source.origQuaternion.clone() : null;
        this.mimicJoints = [...source.mimicJoints];

        return this;
    }

    /**
     * Updates the joint's configuration based on the provided values.
     * Optimized for Inverse Kinematics (Zero Garbage Collection).
     * * @param values - Values representing the new state of the joint.
     * @returns A boolean indicating if the joint state was actually updated.
     */
    public setJointValue(...values: (number | string | null)[]): boolean {
        if (!this.origPosition || !this.origQuaternion) {
            this.origPosition = this.position.clone();
            this.origQuaternion = this.quaternion.clone();
        }

        let didUpdate = false;

        for (let i = 0; i < this.mimicJoints.length; i++) {
            didUpdate = this.mimicJoints[i].updateFromMimickedJoint(...values) || didUpdate;
        }

        switch (this.jointType) {
            case 'fixed':
                return didUpdate;

            case 'continuous':
            case 'revolute': {
                const rawVal = values[0];
                if (rawVal == null) return didUpdate;
                let angle = typeof rawVal === 'string' ? parseFloat(rawVal) : rawVal;
                
                if (angle === this.jointValue[0]) return didUpdate;

                if (!this.ignoreLimits && this.jointType === 'revolute') {
                    angle = Math.min(this.limit.upper, angle);
                    angle = Math.max(this.limit.lower, angle);
                }

                this.quaternion
                    .setFromAxisAngle(this.axis, angle)
                    .premultiply(this.origQuaternion);

                if (this.jointValue[0] !== angle) {
                    this.jointValue[0] = angle;
                    this.matrixWorldNeedsUpdate = true;
                    return true;
                }
                return didUpdate;
            }

            case 'prismatic': {
                const rawVal = values[0];
                if (rawVal == null) return didUpdate;
                let pos = typeof rawVal === 'string' ? parseFloat(rawVal) : rawVal;
                
                if (pos === this.jointValue[0]) return didUpdate;

                if (!this.ignoreLimits) {
                    pos = Math.min(this.limit.upper, pos);
                    pos = Math.max(this.limit.lower, pos);
                }

                this.position.copy(this.origPosition);
                _tempAxis.copy(this.axis).applyEuler(this.rotation);
                this.position.addScaledVector(_tempAxis, pos);

                if (this.jointValue[0] !== pos) {
                    this.jointValue[0] = pos;
                    this.matrixWorldNeedsUpdate = true;
                    return true;
                }
                return didUpdate;
            }

            case 'floating': {
                let valuesChanged = false;
                for (let i = 0; i < 6; i++) {
                    const rawVal = values[i];
                    if (rawVal !== null && rawVal !== undefined) {
                        const parsedVal = typeof rawVal === 'string' ? parseFloat(rawVal) : rawVal;
                        if (this.jointValue[i] !== parsedVal) {
                            this.jointValue[i] = parsedVal;
                            valuesChanged = true;
                        }
                    }
                }
                
                if (!valuesChanged) return didUpdate;

                _tempOrigTransform.compose(this.origPosition, this.origQuaternion, _tempScale);
                _tempQuat.setFromEuler(_tempEuler.set(this.jointValue[3], this.jointValue[4], this.jointValue[5], 'XYZ'));
                _tempPosition.set(this.jointValue[0], this.jointValue[1], this.jointValue[2]);
                _tempTransform.compose(_tempPosition, _tempQuat, _tempScale);

                _tempOrigTransform.premultiply(_tempTransform);
                this.position.setFromMatrixPosition(_tempOrigTransform);
                this.rotation.setFromRotationMatrix(_tempOrigTransform);

                this.matrixWorldNeedsUpdate = true;
                return true;
            }

            case 'planar': {
                let valuesChanged = false;
                for (let i = 0; i < 3; i++) {
                    const rawVal = values[i];
                    if (rawVal !== null && rawVal !== undefined) {
                        const parsedVal = typeof rawVal === 'string' ? parseFloat(rawVal) : rawVal;
                        if (this.jointValue[i] !== parsedVal) {
                            this.jointValue[i] = parsedVal;
                            valuesChanged = true;
                        }
                    }
                }
                
                if (!valuesChanged) return didUpdate;

                _tempOrigTransform.compose(this.origPosition, this.origQuaternion, _tempScale);
                _tempQuat.setFromAxisAngle(this.axis, this.jointValue[2]);
                _tempPosition.set(this.jointValue[0], this.jointValue[1], 0.0);
                _tempTransform.compose(_tempPosition, _tempQuat, _tempScale);

                _tempOrigTransform.premultiply(_tempTransform);
                this.position.setFromMatrixPosition(_tempOrigTransform);
                this.rotation.setFromRotationMatrix(_tempOrigTransform);

                this.matrixWorldNeedsUpdate = true;
                return true;
            }

            default:
                return didUpdate;
        }
    }
}

/** Represents a joint that mimics the movement of another joint. */
export class URDFMimicJoint extends URDFJoint {
    override type = 'URDFMimicJoint';
    /** Name of the target joint being mimicked. */
    public mimicJoint: string | null = null;
    /** Additive offset applied to the mimicked value. */
    public offset = 0;
    /** Multiplier applied to the mimicked value. */
    public multiplier = 1;

    /**
     * Called internally when the parent joint changes. 
     * Applies multiplier and offset without triggering GC pauses.
     * * @param values - State values of the mimicked joint.
     * @returns A boolean indicating if the state actually changed.
     */
    public updateFromMimickedJoint(...values: (number | string | null)[]): boolean {
        const modifiedValues: (number | null)[] = [];
        for (let i = 0; i < values.length; i++) {
            const x = values[i];
            if (x === null || x === undefined) {
                modifiedValues.push(null);
            } else {
                const parsed = typeof x === 'string' ? parseFloat(x) : x;
                modifiedValues.push(parsed * this.multiplier + this.offset);
            }
        }

        return super.setJointValue(...modifiedValues);
    }

    override copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive);
        this.mimicJoint = source.mimicJoint;
        this.offset = source.offset;
        this.multiplier = source.multiplier;
        return this;
    }
}

/** Represents the entire URDF model hierarchy. */
export class URDFRobot extends URDFLink {
    public readonly isURDFRobot = true;
    public urdfRobotNode: Element | null = null;
    public robotName: string | null = null;

    public links: Record<string, URDFLink> = {};
    public joints: Record<string, URDFJoint> = {};
    public colliders: Record<string, URDFCollider> = {};
    public visual: Record<string, URDFVisual> = {};
    public frames: Record<string, URDFBase> = {};

    /** Flat cache of all visual meshes for fast access. */
    public flatVisualMeshes: Mesh[] = [];
    /** Flat cache of all collider meshes for physics and raycasting. */
    public flatColliderMeshes: Mesh[] = [];

    /**
     * Traverses the robot structure to build flat arrays of visual and collider meshes.
     * Eagerly computes bounding volumes required for IK and physics.
     * Runs in O(N) time.
     */
    public updateMeshCaches(): void {
        this.flatVisualMeshes = [];
        this.flatColliderMeshes = [];

        const traverseCaches = (obj: Object3D, isColliderContext: boolean) => {
            let currentContext = isColliderContext;
            
            if ('isURDFCollider' in obj) {
                currentContext = true;
            } else if ('isURDFVisual' in obj) {
                currentContext = false;
            }

            if (obj instanceof Mesh) {
                // Eager computation vital for simulations and physics
                if (obj.geometry) {
                    if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
                    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
                }

                if (currentContext) {
                    this.flatColliderMeshes.push(obj);
                } else {
                    this.flatVisualMeshes.push(obj);
                }
            }

            const children = obj.children;
            for (let i = 0, l = children.length; i < l; i++) {
                traverseCaches(children[i], currentContext);
            }
        };

        traverseCaches(this, false);
    }

    override copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive);

        this.urdfRobotNode = source.urdfRobotNode;
        this.robotName = source.robotName;

        this.links = {};
        this.joints = {};
        this.colliders = {};
        this.visual = {};

        this.traverse(c => {
            if (c instanceof URDFBase) {
                if ('isURDFJoint' in c && c.urdfName in source.joints) {
                    this.joints[c.urdfName] = c as URDFJoint;
                }
                if ('isURDFLink' in c && c.urdfName in source.links) {
                    this.links[c.urdfName] = c as URDFLink;
                }
                if ('isURDFCollider' in c && c.urdfName in source.colliders) {
                    this.colliders[c.urdfName] = c as URDFCollider;
                }
                if ('isURDFVisual' in c && c.urdfName in source.visual) {
                    this.visual[c.urdfName] = c as URDFVisual;
                }
            }
            if (c instanceof Mesh) {
                retainMeshResources(c);
            }
        });

        for (const jointName in this.joints) {
            const joint = this.joints[jointName];
            joint.mimicJoints = joint.mimicJoints.map(mj => this.joints[mj.name] as URDFMimicJoint);
        }

        this.frames = {
            ...this.colliders,
            ...this.visual,
            ...this.links,
            ...this.joints,
        };

        this.updateMeshCaches();

        return this;
    }

    /** Retrieves a frame (Link, Joint, Visual, or Collider) by name. */
    public getFrame(name: string): URDFBase | undefined {
        return this.frames[name];
    }

    /**
     * Updates a specific joint's state by name.
     * * @param jointName - The string identifier of the joint.
     * @param angle - The new value(s) for the joint.
     * @returns True if the value changed, false otherwise.
     */
    public setJointValue(jointName: string, ...angle: (number | string | null)[]): boolean {
        const joint = this.joints[jointName];
        if (joint) {
            return joint.setJointValue(...angle);
        }
        return false;
    }

    /**
     * Batch updates multiple joints simultaneously.
     * * @param values - A record mapping joint names to their target values.
     * @returns True if any joint state was updated.
     */
    public setJointValues(values: Record<string, number | (number | string | null)[]>): boolean {
        let didChange = false;
        for (const name in values) {
            const value = values[name];
            if (Array.isArray(value)) {
                didChange = this.setJointValue(name, ...value) || didChange;
            } else {
                didChange = this.setJointValue(name, value) || didChange;
            }
        }
        return didChange;
    }
}