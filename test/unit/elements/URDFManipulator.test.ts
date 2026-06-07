import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { URDFRobot, URDFJoint } from '../../../src/core/URDFClasses';
import { PointerURDFDragControls } from '../../../src/core/URDFDragControls';
import { URDFManipulator } from '../../../src/elements/URDFManipulator';
import '../../../src/elements/URDFManipulator';

describe('URDFManipulator Web Component', () => {
    let manipulator: URDFManipulator;

    beforeEach(() => {
        document.body.innerHTML = '';
        manipulator = document.createElement('urdf-manipulator') as URDFManipulator;
        document.body.appendChild(manipulator);

        Object.defineProperty(manipulator, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(manipulator, 'clientHeight', { value: 600, configurable: true });
        
        // Prevent continuous RequestAnimationFrame loops in async tests
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // =========================================================================
    // SECTION: Lifecycle & Setup
    // =========================================================================
    describe('Lifecycle & Setup', () => {

        describe('constructor()', () => {
            it('should register and instantiate DragControls and Highlight Material', () => {
                expect(customElements.get('urdf-manipulator')).toBeDefined();
                expect(manipulator.dragControls).toBeInstanceOf(PointerURDFDragControls);
                expect(manipulator.highlightMaterial).toBeInstanceOf(THREE.MeshPhongMaterial);
                expect(manipulator.highlightMaterial.color.getHexString()).toBe('ffffff'); // Default is '#FFFFFF'
            });
        });

        describe('disconnectedCallback()', () => {
            it('should dispose and disconnect DragControls when removed from the DOM', () => {
                const disposeSpy = vi.spyOn(manipulator.dragControls, 'dispose');
                
                // Removing the component from DOM triggers disconnectedCallback
                document.body.removeChild(manipulator);
                
                expect(disposeSpy).toHaveBeenCalled();
            });
        });

        describe('attributeChangedCallback()', () => {
            it('should update highlight material when "highlight-color" changes', () => {
                manipulator.setAttribute('highlight-color', '#ff0000');
                expect(manipulator.highlightMaterial.color.getHexString()).toBe('ff0000');
                expect(manipulator.highlightMaterial.emissive.getHexString()).toBe('ff0000');
            });

            it('should toggle drag controls via "disable-dragging" attribute', () => {
                expect(manipulator.dragControls.enabled).toBe(true);

                manipulator.setAttribute('disable-dragging', 'true');
                expect(manipulator.dragControls.enabled).toBe(false);

                manipulator.removeAttribute('disable-dragging');
                expect(manipulator.dragControls.enabled).toBe(true);
            });
        });
    });

    // =========================================================================
    // SECTION: Getters & Setters
    // =========================================================================
    describe('Getters & Setters', () => {
        it('should correctly handle falsy values on setters for reactive attributes', () => {
            // Force the setter to true
            manipulator.disableDragging = true;
            expect(manipulator.hasAttribute('disable-dragging')).toBe(true);
            
            // Covers the falsy branch of the setter -> removeAttribute
            manipulator.disableDragging = false;
            expect(manipulator.hasAttribute('disable-dragging')).toBe(false);

            // Force a valid color string
            manipulator.highlightColor = '#ff0000';
            expect(manipulator.getAttribute('highlight-color')).toBe('#ff0000');
            
            // Covers the falsy branch of the color setter sending an empty string
            manipulator.highlightColor = '';
            expect(manipulator.hasAttribute('highlight-color')).toBe(false);
        });
    });

    // =========================================================================
    // SECTION: Drag Controls & Event Handlers
    // =========================================================================
    describe('Drag Controls & Event Handlers', () => {
        let mockJoint: URDFJoint;

        beforeEach(() => {
            mockJoint = new URDFJoint();
            mockJoint.name = 'TestJoint';
            mockJoint.jointType = 'continuous';
            
            const robot = new URDFRobot();
            robot.joints['TestJoint'] = mockJoint;
            manipulator.robot = robot;
        });

        describe('onDragStart()', () => {
            it('should emit "manipulate-start" and disable orbit controls on drag start', () => {
                const eventSpy = vi.fn();
                manipulator.addEventListener('manipulate-start', eventSpy);
                const redrawSpy = vi.spyOn(manipulator, 'redraw');

                manipulator.dragControls.onDragStart(mockJoint);

                expect(manipulator.controls.enabled).toBe(false); // Locks camera
                expect(redrawSpy).toHaveBeenCalled();
                expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                    type: 'manipulate-start',
                    detail: 'TestJoint'
                }));
            });
        });

        describe('onDragEnd()', () => {
            it('should emit "manipulate-end" and restore orbit controls on drag end', () => {
                manipulator.controls.enabled = false;
                const eventSpy = vi.fn();
                manipulator.addEventListener('manipulate-end', eventSpy);
                const redrawSpy = vi.spyOn(manipulator, 'redraw');

                manipulator.dragControls.onDragEnd(mockJoint);

                expect(manipulator.controls.enabled).toBe(true); // Unlocks camera
                expect(redrawSpy).toHaveBeenCalled();
                expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
                    type: 'manipulate-end',
                    detail: 'TestJoint'
                }));
            });
        });

        describe('updateJoint()', () => {
            it('should update the joint angle when controls notify a change', () => {
                const updateSpy = vi.spyOn(manipulator, 'setJointValue');
                manipulator.dragControls.updateJoint(mockJoint, Math.PI);
                expect(updateSpy).toHaveBeenCalledWith('TestJoint', Math.PI);
            });
        });
    });

    // =========================================================================
    // SECTION: Private Methods (Visual Highlight Algorithm)
    // =========================================================================
    describe('Private Methods & Logic', () => {
        
        describe('_highlightLinkGeometry() (via onHover / onUnhover)', () => {
            let mockJoint: URDFJoint;
            let mockMesh: THREE.Mesh;
            let originalMaterial: THREE.MeshBasicMaterial;

            beforeEach(() => {
                mockJoint = new URDFJoint();
                mockJoint.name = 'TestJoint';
                mockJoint.jointType = 'continuous';

                // Create a child Mesh to test standard highlighting
                originalMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                mockMesh = new THREE.Mesh(new THREE.BufferGeometry(), originalMaterial);
                mockJoint.add(mockMesh);
                
                const robot = new URDFRobot();
                robot.joints['TestJoint'] = mockJoint;
                manipulator.robot = robot;
            });

            it('should apply highlight material on hover and emit "joint-mouseover"', () => {
                const eventSpy = vi.fn();
                manipulator.addEventListener('joint-mouseover', eventSpy);

                manipulator.dragControls.onHover(mockJoint);

                expect(mockMesh.material).toBe(manipulator.highlightMaterial);
                expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'joint-mouseover' }));
            });

            it('should restore original material on unhover and emit "joint-mouseout"', () => {
                const eventSpy = vi.fn();
                manipulator.addEventListener('joint-mouseout', eventSpy);

                // Simulate hover and unhover lifecycle
                manipulator.dragControls.onHover(mockJoint);
                manipulator.dragControls.onUnhover(mockJoint);

                expect(mockMesh.material).toBe(originalMaterial);
                expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'joint-mouseout' }));
            });

            it('should not overwrite the original material in the WeakMap if onHover is called consecutively', () => {
                const privates = manipulator as unknown as { 
                    _originalMaterials: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]> 
                };
                
                const setSpy = vi.spyOn(privates._originalMaterials, 'set');

                manipulator.dragControls.onHover(mockJoint);
                expect(mockMesh.material).toBe(manipulator.highlightMaterial);
                expect(setSpy).toHaveBeenCalledTimes(1);

                manipulator.dragControls.onHover(mockJoint);
                
                expect(setSpy).toHaveBeenCalledTimes(1);

                manipulator.dragControls.onUnhover(mockJoint);
                expect(mockMesh.material).toBe(originalMaterial);

                setSpy.mockRestore();
            });
            

            it('should safely ignore unhover requests (revert logic) for meshes that were never highlighted', () => {
                // Directly trigger unhover without a prior hover to force the false branch evaluation
                // on: if (this._originalMaterials.has(c))
                manipulator.dragControls.onUnhover(mockJoint);
                
                expect(mockMesh.material).toBe(originalMaterial);
            });
            
            it('should prevent highlighting sub-trees if a nested joint is encountered', () => {
                const nestedJoint = new URDFJoint();
                nestedJoint.jointType = 'continuous'; 
                
                const nestedMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
                nestedJoint.add(nestedMesh);
                mockJoint.add(nestedJoint);

                manipulator.dragControls.onHover(mockJoint);

                // Main mesh should be highlighted
                expect(mockMesh.material).toBe(manipulator.highlightMaterial);
                
                // Nested mesh should remain unaltered as it belongs to an independent joint
                expect(nestedMesh.material).not.toBe(manipulator.highlightMaterial);
            });

            it('should bypass objects flagged as URDFColliders during the highlight traversal', () => {
                const colliderMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
                
                Object.defineProperty(colliderMesh, 'isURDFCollider', { value: true });
                mockJoint.add(colliderMesh);

                manipulator.dragControls.onHover(mockJoint);

                // Main visual mesh should be successfully highlighted
                expect(mockMesh.material).toBe(manipulator.highlightMaterial);
                
                // Collider mesh should remain completely unaltered during the recursive traversal
                expect(colliderMesh.material).not.toBe(manipulator.highlightMaterial);
                expect((colliderMesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x00ff00);
            });
        });
    });
});