import { Euler, Object3D, Vector3, Quaternion, Matrix4, Mesh } from 'three';

const _tempAxis = new Vector3();
const _tempEuler = new Euler();
const _tempTransform = new Matrix4();
const _tempOrigTransform = new Matrix4();
const _tempQuat = new Quaternion();
const _tempScale = new Vector3(1.0, 1.0, 1.0);
const _tempPosition = new Vector3();

// --- SISTEMA DE GESTIÓN DE MEMORIA (REFERENCE COUNTING) ---

export function retainResource(res: any) {
    if (!res) return;
    if (Array.isArray(res)) {
        res.forEach(retainResource);
        return;
    }
    res.userData = res.userData || {};
    res.userData.refCount = (res.userData.refCount || 0) + 1;
}

export function releaseResource(res: any) {
    if (!res) return;
    if (Array.isArray(res)) {
        res.forEach(releaseResource);
        return;
    }
    if (res.userData && typeof res.userData.refCount === 'number') {
        res.userData.refCount--;
        if (res.userData.refCount <= 0) {
            if (typeof res.dispose === 'function') res.dispose();
            delete res.userData.refCount;
        }
    }
}

export function retainMeshResources(mesh: Mesh) {
    if (mesh.geometry) retainResource(mesh.geometry);
    if (mesh.material) {
        retainResource(mesh.material);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
            if ((m as any).map) retainResource((m as any).map);
        });
    }
}

export function releaseMeshResources(mesh: Mesh) {
    if (mesh.geometry) releaseResource(mesh.geometry);
    if (mesh.material) {
        releaseResource(mesh.material);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
            if ((m as any).map) releaseResource((m as any).map);
        });
    }
}

// --- CLASES CORE ---

export interface JointLimits {
    lower: number;
    upper: number;
    effort: number;
    velocity: number;
}

export interface InertialOrigin {
    xyz: [number, number, number];
    rpy: [number, number, number];
}

export interface InertiaMatrix {
    ixx: number; ixy: number; ixz: number;
    iyy: number; iyz: number; izz: number;
}

export interface InertialProperties {
    mass: number;
    origin: InertialOrigin;
    inertia: InertiaMatrix;
}

export type JointType = 'fixed' | 'continuous' | 'revolute' | 'prismatic' | 'planar' | 'floating';

export class URDFBase extends Object3D {
    public urdfNode: Element | null = null;
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

export class URDFCollider extends URDFBase {
    public readonly isURDFCollider = true;
    override type = 'URDFCollider';
}

export class URDFVisual extends URDFBase {
    public readonly isURDFVisual = true;
    override type = 'URDFVisual';
}

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

export class URDFJoint extends URDFBase {
    public readonly isURDFJoint = true;
    override type = 'URDFJoint';

    private _jointType: JointType = 'fixed';
    public jointValue: number[] = [];
    public axis = new Vector3(1, 0, 0);
    public limit: JointLimits = { lower: 0, upper: 0, effort: 0, velocity: 0 };
    public ignoreLimits = false;

    public origPosition: Vector3 | null = null;
    public origQuaternion: Quaternion | null = null;
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

    public setJointValue(...values: (number | null)[]): boolean {
        const parsedValues = values.map(v => (v === null ? null : Reflect.apply(parseFloat, null, [String(v)])));

        if (!this.origPosition || !this.origQuaternion) {
            this.origPosition = this.position.clone();
            this.origQuaternion = this.quaternion.clone();
        }

        let didUpdate = false;

        for (const joint of this.mimicJoints) {
            didUpdate = joint.updateFromMimickedJoint(...parsedValues) || didUpdate;
        }

        switch (this.jointType) {
            case 'fixed':
                return didUpdate;

            case 'continuous':
            case 'revolute': {
                let angle = parsedValues[0];
                if (angle == null || angle === this.jointValue[0]) return didUpdate;

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
                let pos = parsedValues[0];
                if (pos == null || pos === this.jointValue[0]) return didUpdate;

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
                if (this.jointValue.every((value, index) => parsedValues[index] === value || parsedValues[index] === null)) {
                    return didUpdate;
                }

                for (let i = 0; i < 6; i++) {
                    const val = parsedValues[i];
                    if (val !== null && val !== undefined) {
                        this.jointValue[i] = val;
                    }
                }

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
                if (this.jointValue.every((value, index) => parsedValues[index] === value || parsedValues[index] === null)) {
                    return didUpdate;
                }

                for (let i = 0; i < 3; i++) {
                    const val = parsedValues[i];
                    if (val !== null && val !== undefined) {
                        this.jointValue[i] = val;
                    }
                }

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
        }

        return didUpdate;
    }
}

export class URDFMimicJoint extends URDFJoint {
    override type = 'URDFMimicJoint';
    public mimicJoint: string | null = null;
    public offset = 0;
    public multiplier = 1;

    public updateFromMimickedJoint(...values: (number | null)[]): boolean {
        const modifiedValues = values.map(x => {
            if (x === null) return null;
            return x * this.multiplier + this.offset;
        });

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

export class URDFRobot extends URDFLink {
    public readonly isURDFRobot = true;
    public urdfRobotNode: Element | null = null;
    public robotName: string | null = null;

    public links: Record<string, URDFLink> = {};
    public joints: Record<string, URDFJoint> = {};
    public colliders: Record<string, URDFCollider> = {};
    public visual: Record<string, URDFVisual> = {};
    public frames: Record<string, URDFBase> = {};

    // --- CACHÉ PLANO DE MALLAS (FASE 2) ---
    public flatVisualMeshes: Mesh[] = [];
    public flatColliderMeshes: Mesh[] = [];

    public updateMeshCaches() {
        this.flatVisualMeshes = [];
        this.flatColliderMeshes = [];

        this.traverse((c) => {
            if (c instanceof Mesh) {
                let isCollider = false;
                let curr: Object3D | null = c.parent;
                // Subimos por el árbol para saber si esta malla es colisión o visual
                while (curr && curr !== this) {
                    if ('isURDFCollider' in curr) {
                        isCollider = true;
                        break;
                    }
                    if ('isURDFVisual' in curr) {
                        isCollider = false;
                        break;
                    }
                    curr = curr.parent;
                }
                
                if (isCollider) {
                    this.flatColliderMeshes.push(c);
                } else {
                    this.flatVisualMeshes.push(c);
                }
            }
        });
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

        // Autogenerar el caché tras clonar para mantener la optimización $O(1)$
        this.updateMeshCaches();

        return this;
    }

    public getFrame(name: string): URDFBase | undefined {
        return this.frames[name];
    }

    public setJointValue(jointName: string, ...angle: (number | null)[]): boolean {
        const joint = this.joints[jointName];
        if (joint) {
            return joint.setJointValue(...angle);
        }
        return false;
    }

    public setJointValues(values: Record<string, number | (number | null)[]>): boolean {
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