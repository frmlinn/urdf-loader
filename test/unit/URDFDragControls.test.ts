import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scene, PerspectiveCamera, Vector3, Mesh, Raycaster, Intersection } from 'three';
import { URDFJoint } from '../../src/core/URDFClasses';
import { URDFDragControls, PointerURDFDragControls, isJoint } from '../../src/core/URDFDragControls';

// ==========================================
// MOCKS & UTILITIES SETUP
// ==========================================

/**
 * Unit tests for the URDF Drag Controls system.
 * Validates raycasting intersections, mathematical delta calculations for continuous 
 * and prismatic joints, pointer event handling, and control state transitions.
 */
describe('URDFDragControls Module', () => {

    describe('isJoint Utility', () => {
        it('should return true only for valid, movable URDFJoints', () => {
            const joint = new URDFJoint();
            joint.jointType = 'revolute';
            expect(isJoint(joint)).toBe(true);

            joint.jointType = 'prismatic';
            expect(isJoint(joint)).toBe(true);
        });

        it('should return false for fixed joints, standard meshes, or null', () => {
            const joint = new URDFJoint(); 
            expect(isJoint(joint)).toBe(false); // Default is 'fixed'
            
            const mesh = new Mesh();
            expect(isJoint(mesh)).toBe(false);
            
            expect(isJoint(null)).toBe(false);
            expect(isJoint(undefined)).toBe(false);
        });
    });

    describe('URDFDragControls (Base Class)', () => {
        let scene: Scene;
        let controls: URDFDragControls;
        let joint: URDFJoint;
        let childMesh: Mesh;

        beforeEach(() => {
            scene = new Scene();
            controls = new URDFDragControls(scene);
            
            joint = new URDFJoint();
            joint.jointType = 'revolute';
            
            childMesh = new Mesh();
            joint.add(childMesh);
            scene.add(joint);

            scene.updateMatrixWorld(true);
        });

        it('should correctly traverse and identify the nearest parent joint on hover', () => {
            vi.spyOn(controls.raycaster, 'intersectObject').mockReturnValue([{
                distance: 10,
                point: new Vector3(1, 1, 1),
                object: childMesh
            } as unknown as Intersection]);

            const hoverSpy = vi.fn();
            controls.onHover = hoverSpy;

            controls.update();

            expect(controls.hovered).toBe(joint);
            expect(hoverSpy).toHaveBeenCalledWith(joint);
            expect(controls.initialGrabPoint.equals(new Vector3(1, 1, 1))).toBe(true);
        });

        it('should silently handle raycast hits on objects with no parent joint', () => {
            const orphanMesh = new Mesh();
            scene.add(orphanMesh);

            vi.spyOn(controls.raycaster, 'intersectObject').mockReturnValue([{
                distance: 5,
                point: new Vector3(0, 0, 0),
                object: orphanMesh
            } as unknown as Intersection]);

            controls.update();

            expect(controls.hovered).toBeNull();
        });

        it('should clear hovered joint and emit unhover if raycaster hits nothing', () => {
            controls.hovered = joint;
            const unhoverSpy = vi.fn();
            controls.onUnhover = unhoverSpy;
            
            vi.spyOn(controls.raycaster, 'intersectObject').mockReturnValue([]);
            
            controls.update();
            
            expect(controls.hovered).toBeNull();
            expect(unhoverSpy).toHaveBeenCalledWith(joint);
        });

        it('should calculate revolute drag delta mathematically', () => {
            joint.axis.set(0, 0, 1); 
            const start = new Vector3(1, 0, 0);
            const end = new Vector3(0, 1, 0); 

            const delta = controls.getRevoluteDelta(joint, start, end);
            expect(delta).toBeCloseTo(Math.PI / 2);
        });

        it('should calculate prismatic drag delta mathematically', () => {
            joint.jointType = 'prismatic';
            joint.axis.set(1, 0, 0); 
            const start = new Vector3(0, 0, 0);
            const end = new Vector3(5, 2, -1); 

            const delta = controls.getPrismaticDelta(joint, start, end);
            expect(delta).toBeCloseTo(5);
        });

        it('should calculate prismatic drag delta when the joint has no parent', () => {
            const orphanJoint = new URDFJoint();
            orphanJoint.jointType = 'prismatic';
            orphanJoint.axis.set(0, 1, 0); 
            
            Object.defineProperty(orphanJoint, 'parent', { value: null });
            
            const start = new Vector3(0, 0, 0);
            const end = new Vector3(0, 5, 0); 
            
            const delta = controls.getPrismaticDelta(orphanJoint, start, end);
            expect(delta).toBeCloseTo(5);
        });

        describe('State Transitions & Early Returns', () => {
            it('should transition to manipulating state when successfully grabbed', () => {
                const dragStartSpy = vi.fn();
                controls.onDragStart = dragStartSpy;

                controls.hovered = joint;
                controls.setGrabbed(true);
                
                expect(controls.manipulating).toBe(joint);
                expect(dragStartSpy).toHaveBeenCalledWith(joint);
            });

            it('should transition to released state when successfully dropped', () => {
                const dragEndSpy = vi.fn();
                controls.onDragEnd = dragEndSpy;

                controls.manipulating = joint;
                controls.setGrabbed(false);
                
                expect(controls.manipulating).toBeNull();
                expect(dragEndSpy).toHaveBeenCalledWith(joint);
            });

            it('should abort grab attempt if already manipulating or no joint is hovered', () => {
                const dragStartSpy = vi.fn();
                controls.onDragStart = dragStartSpy;

                controls.hovered = null;
                controls.setGrabbed(true);
                expect(dragStartSpy).not.toHaveBeenCalled();

                controls.hovered = joint;
                controls.manipulating = joint;
                controls.setGrabbed(true);
                expect(dragStartSpy).not.toHaveBeenCalled();
            });

            it('should abort drop attempt if not currently manipulating anything', () => {
                const dragEndSpy = vi.fn();
                controls.onDragEnd = dragEndSpy;

                controls.manipulating = null;
                controls.setGrabbed(false);
                
                expect(dragEndSpy).not.toHaveBeenCalled();
            });
        });

        it('should move ray and update joint value if manipulating', () => {
            const updateSpy = vi.fn();
            controls.updateJoint = updateSpy;
            
            controls.hovered = joint;
            controls.setGrabbed(true);

            vi.spyOn(controls, 'getRevoluteDelta').mockReturnValue(0.5);

            const newRay = new Raycaster();
            controls.moveRay(newRay.ray);

            expect(updateSpy).toHaveBeenCalledWith(joint, joint.angle + 0.5);
        });
    });

    describe('PointerURDFDragControls (DOM Events)', () => {
        let scene: Scene;
        let camera: PerspectiveCamera;
        let domElement: HTMLElement;
        let pointerControls: PointerURDFDragControls;

        beforeEach(() => {
            scene = new Scene();
            camera = new PerspectiveCamera();
            domElement = document.createElement('div');
            
            domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} } as DOMRect);
            domElement.setPointerCapture = vi.fn();
            domElement.releasePointerCapture = vi.fn();

            pointerControls = new PointerURDFDragControls(scene, camera, domElement);
        });

        it('should attach and process pointerdown events', () => {
            const moveRaySpy = vi.spyOn(pointerControls, 'moveRay');
            const setGrabbedSpy = vi.spyOn(pointerControls, 'setGrabbed');

            const event = new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1 });
            domElement.dispatchEvent(event);

            expect(moveRaySpy).toHaveBeenCalled();
            expect(setGrabbedSpy).toHaveBeenCalledWith(true);
            expect(domElement.setPointerCapture).toHaveBeenCalledWith(1);
        });

        it('should attach and process pointermove events', () => {
            const moveRaySpy = vi.spyOn(pointerControls, 'moveRay');

            const event = new PointerEvent('pointermove', { clientX: 450, clientY: 350 });
            domElement.dispatchEvent(event);

            expect(moveRaySpy).toHaveBeenCalled();
        });

        it('should attach and process pointerup events', () => {
            const moveRaySpy = vi.spyOn(pointerControls, 'moveRay');
            const setGrabbedSpy = vi.spyOn(pointerControls, 'setGrabbed');

            const event = new PointerEvent('pointerup', { clientX: 400, clientY: 300, pointerId: 1 });
            domElement.dispatchEvent(event);

            expect(moveRaySpy).toHaveBeenCalled();
            expect(setGrabbedSpy).toHaveBeenCalledWith(false);
            expect(domElement.releasePointerCapture).toHaveBeenCalledWith(1);
        });

        it('should abort pointer event processing if controls are disabled', () => {
            pointerControls.enabled = false;
            const moveRaySpy = vi.spyOn(pointerControls, 'moveRay');
            
            domElement.dispatchEvent(new PointerEvent('pointerdown'));
            domElement.dispatchEvent(new PointerEvent('pointermove'));
            domElement.dispatchEvent(new PointerEvent('pointerup'));

            expect(moveRaySpy).not.toHaveBeenCalled();
        });

        it('should cleanly remove event listeners on dispose', () => {
            const removeSpy = vi.spyOn(domElement, 'removeEventListener');
            pointerControls.dispose();
            
            expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
            expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
        });

        it('should handle getRevoluteDelta mathematical edge cases when camera is orthogonal to joint plane', () => {
            const joint = new URDFJoint();
            joint.jointType = 'revolute';
            joint.axis.set(0, 0, 1); 
            joint.updateMatrixWorld(true);

            pointerControls.initialGrabPoint.set(0, 0, 0);
            
            // CASE 1: Camera is parallel to the Z axis (high dot product)
            camera.position.set(0, 0, 10);
            camera.updateMatrixWorld(true);
            
            const start1 = new Vector3(1, 0, 0);
            const end1 = new Vector3(0, 1, 0); 
            const delta1 = pointerControls.getRevoluteDelta(joint, start1, end1);
            expect(delta1).toBeCloseTo(Math.PI / 2);

            // CASE 2: Camera is orthogonal to the Z axis (looking from X axis).
            // Triggers the fallback algorithm to prevent infinite jumps/NaNs
            camera.position.set(10, 0, 0);
            camera.updateMatrixWorld(true);
            
            const start2 = new Vector3(0, 1, 0);
            const end2 = new Vector3(0, 1, 1); 
            const delta2 = pointerControls.getRevoluteDelta(joint, start2, end2);
            
            expect(typeof delta2).toBe('number');
            expect(Number.isNaN(delta2)).toBe(false);
        });
    });
});