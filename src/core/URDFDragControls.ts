import { Raycaster, Vector3, Plane, Vector2, Object3D, Camera, Scene } from 'three';
import { URDFJoint } from './URDFClasses';

/**
 * Helper function to determine if a Three.js object is a movable URDF joint.
 */
export function isJoint(j: unknown): j is URDFJoint {
    return !!j && typeof j === 'object' && 'isURDFJoint' in j && (j as URDFJoint).jointType !== 'fixed';
}

/** * Traverses up the hierarchy to find the nearest parent joint.
 * @internal 
 */
function findNearestJoint(child: Object3D | null): URDFJoint | null {
    let curr = child;
    while (curr) {
        if (isJoint(curr)) return curr;
        curr = curr.parent;
    }
    return null;
}

// Module-level temporaries to avoid GC during drag updates
const prevHitPoint = new Vector3();
const newHitPoint = new Vector3();
const pivotPoint = new Vector3();
const tempVector = new Vector3();
const tempVector2 = new Vector3();
const projectedStartPoint = new Vector3();
const projectedEndPoint = new Vector3();
const plane = new Plane();

/**
 * Controller class to interactively manipulate URDF joints in a Scene via raycasting.
 */
export class URDFDragControls {
    /** Whether the controls are currently active. */
    public enabled: boolean = true;
    public scene: Scene;
    public raycaster: Raycaster;
    /** The point in world space where the initial interaction began. */
    public initialGrabPoint: Vector3;

    public hitDistance: number = -1;
    public hovered: URDFJoint | null = null;
    public manipulating: URDFJoint | null = null;

    /** Callback fired when dragging begins. */
    public onDragStart: (joint: URDFJoint) => void = () => {};
    /** Callback fired when dragging ends. */
    public onDragEnd: (joint: URDFJoint) => void = () => {};
    /** Callback fired when hovering over a joint. */
    public onHover: (joint: URDFJoint) => void = () => {};
    /** Callback fired when a joint is no longer hovered. */
    public onUnhover: (joint: URDFJoint) => void = () => {};
    /** Custom handler applied when the joint value updates. */
    public updateJoint: (joint: URDFJoint, angle: number) => void = (joint, angle) => {
        joint.setJointValue(angle);
    };

    constructor(scene: Scene) {
        this.scene = scene;
        this.raycaster = new Raycaster();
        this.initialGrabPoint = new Vector3();
    }

    /** Computes intersection changes to trigger hover states. */
    public update(): void {
        if (this.manipulating) return;

        let hoveredJoint: URDFJoint | null = null;
        const intersections = this.raycaster.intersectObject(this.scene, true);
        
        if (intersections.length !== 0) {
            const hit = intersections[0];
            this.hitDistance = hit.distance;
            hoveredJoint = findNearestJoint(hit.object);
            this.initialGrabPoint.copy(hit.point);
        }

        if (hoveredJoint !== this.hovered) {
            if (this.hovered) this.onUnhover(this.hovered);
            this.hovered = hoveredJoint;
            if (hoveredJoint) this.onHover(hoveredJoint);
        }
    }

    /**
     * Calculates angular delta for continuous/revolute joints based on drag distance.
     * * @param joint - Target URDF joint.
     * @param startPoint - Starting world coordinate.
     * @param endPoint - Ending world coordinate.
     * @returns The angular delta in radians.
     */
    public getRevoluteDelta(joint: URDFJoint, startPoint: Vector3, endPoint: Vector3): number {
        tempVector
            .copy(joint.axis)
            .transformDirection(joint.matrixWorld)
            .normalize();
        pivotPoint
            .set(0, 0, 0)
            .applyMatrix4(joint.matrixWorld);
        plane
            .setFromNormalAndCoplanarPoint(tempVector, pivotPoint);

        plane.projectPoint(startPoint, projectedStartPoint);
        plane.projectPoint(endPoint, projectedEndPoint);

        projectedStartPoint.sub(pivotPoint);
        projectedEndPoint.sub(pivotPoint);

        tempVector.crossVectors(projectedStartPoint, projectedEndPoint);

        const direction = Math.sign(tempVector.dot(plane.normal));
        return direction * projectedEndPoint.angleTo(projectedStartPoint);
    }

    /**
     * Calculates linear delta for prismatic joints based on drag distance.
     * * @param joint - Target URDF joint.
     * @param startPoint - Starting world coordinate.
     * @param endPoint - Ending world coordinate.
     * @returns The linear delta in metric units.
     */
    public getPrismaticDelta(joint: URDFJoint, startPoint: Vector3, endPoint: Vector3): number {
        tempVector.subVectors(endPoint, startPoint);
        if (joint.parent) {
            plane.normal
                .copy(joint.axis)
                .transformDirection(joint.parent.matrixWorld)
                .normalize();
        } else {
            plane.normal.copy(joint.axis).normalize();
        }

        return tempVector.dot(plane.normal);
    }

    /** Updates the position of the internal ray to process drags. */
    public moveRay(toRay: Raycaster['ray']): void {
        const { raycaster, hitDistance, manipulating } = this;
        const { ray } = raycaster;

        if (manipulating) {
            ray.at(hitDistance, prevHitPoint);
            toRay.at(hitDistance, newHitPoint);

            let delta = 0;
            if (manipulating.jointType === 'revolute' || manipulating.jointType === 'continuous') {
                delta = this.getRevoluteDelta(manipulating, prevHitPoint, newHitPoint);
            } else if (manipulating.jointType === 'prismatic') {
                delta = this.getPrismaticDelta(manipulating, prevHitPoint, newHitPoint);
            }

            if (delta) this.updateJoint(manipulating, manipulating.angle + delta);
        }

        this.raycaster.ray.copy(toRay);
        this.update();
    }

    /** Toggles the internal manipulation state based on current hovers. */
    public setGrabbed(grabbed: boolean): void {
        const { hovered, manipulating } = this;

        if (grabbed) {
            if (manipulating !== null || hovered === null) return;
            this.manipulating = hovered;
            this.onDragStart(hovered);
        } else {
            if (this.manipulating === null) return;
            this.onDragEnd(this.manipulating);
            this.manipulating = null;
            this.update();
        }
    }
}

/**
 * Extension of URDFDragControls targeting DOM pointer events (Mouse, Touch).
 */
export class PointerURDFDragControls extends URDFDragControls {
    public camera: Camera;
    public domElement: HTMLElement;

    private _pointerDown: (e: PointerEvent) => void;
    private _pointerMove: (e: PointerEvent) => void;
    private _pointerUp: (e: PointerEvent) => void;

    constructor(scene: Scene, camera: Camera, domElement: HTMLElement) {
        super(scene);
        this.camera = camera;
        this.domElement = domElement;

        const raycaster = new Raycaster();
        const pointer = new Vector2();

        const updatePointer = (e: PointerEvent) => {
            const rect = domElement.getBoundingClientRect();
            pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };

        this._pointerDown = (e: PointerEvent) => {
            if (!this.enabled) return;
            updatePointer(e);
            raycaster.setFromCamera(pointer, this.camera);
            this.moveRay(raycaster.ray);
            this.setGrabbed(true);
            this.domElement.setPointerCapture(e.pointerId);
        };

        this._pointerMove = (e: PointerEvent) => {
            if (!this.enabled) return;
            updatePointer(e);
            raycaster.setFromCamera(pointer, this.camera);
            this.moveRay(raycaster.ray);
        };

        this._pointerUp = (e: PointerEvent) => {
            if (!this.enabled) return;
            updatePointer(e);
            raycaster.setFromCamera(pointer, this.camera);
            this.moveRay(raycaster.ray);
            this.setGrabbed(false);
            this.domElement.releasePointerCapture(e.pointerId);
        };

        domElement.addEventListener('pointerdown', this._pointerDown);
        domElement.addEventListener('pointermove', this._pointerMove);
        domElement.addEventListener('pointerup', this._pointerUp);
    }

    /**
     * Overrides the base revolute calculator to handle edge cases 
     * where viewing angles cause mathematical discontinuities.
     */
    public override getRevoluteDelta(joint: URDFJoint, startPoint: Vector3, endPoint: Vector3): number {
        const { camera, initialGrabPoint } = this;

        tempVector
            .copy(joint.axis)
            .transformDirection(joint.matrixWorld)
            .normalize();
        pivotPoint
            .set(0, 0, 0)
            .applyMatrix4(joint.matrixWorld);
        plane
            .setFromNormalAndCoplanarPoint(tempVector, pivotPoint);

        tempVector
            .copy(camera.position)
            .sub(initialGrabPoint)
            .normalize();

        // Check if camera vector and joint plane normal are sufficiently aligned
        if (Math.abs(tempVector.dot(plane.normal)) > 0.3) {
            return super.getRevoluteDelta(joint, startPoint, endPoint);
        } else {
            tempVector.set(0, 1, 0).transformDirection(camera.matrixWorld);

            plane.projectPoint(startPoint, projectedStartPoint);
            plane.projectPoint(endPoint, projectedEndPoint);

            tempVector.set(0, 0, -1).transformDirection(camera.matrixWorld);
            tempVector.cross(plane.normal);
            tempVector2.subVectors(endPoint, startPoint);

            return tempVector.dot(tempVector2);
        }
    }

    /** Removes attached DOM event listeners safely. */
    public dispose(): void {
        this.domElement.removeEventListener('pointerdown', this._pointerDown);
        this.domElement.removeEventListener('pointermove', this._pointerMove);
        this.domElement.removeEventListener('pointerup', this._pointerUp);
    }
}