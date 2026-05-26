import * as THREE from 'three';
import { URDFViewer } from './URDFViewer';
import { PointerURDFDragControls, isJoint } from '../core/URDFDragControls';
import { URDFJoint } from '../core/URDFClasses';

/**
 * Web Component that extends URDFViewer to provide interactive manipulation 
 * of the URDF joints via pointer drag controls.
 */
export class URDFManipulator extends URDFViewer {
    /** Controller handling raycasting and pointer interactions. */
    public dragControls: PointerURDFDragControls;
    /** Material applied to links when they are hovered or manipulated. */
    public highlightMaterial: THREE.MeshPhongMaterial;

    /** * WeakMap to safely store original materials without polluting 
     * THREE.Mesh instances with dynamic "any" properties. 
     */
    private _originalMaterials: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]> = new WeakMap();

    /** Registers attributes to trigger the `attributeChangedCallback`. */
    static get observedAttributes(): string[] {
        return ['highlight-color', 'disable-dragging', ...super.observedAttributes];
    }

    // --- Reactive Attributes ---

    /** Gets or sets whether joint dragging is disabled. */
    get disableDragging(): boolean { return this.hasAttribute('disable-dragging'); }
    set disableDragging(val: boolean) { val ? this.setAttribute('disable-dragging', 'true') : this.removeAttribute('disable-dragging'); }

    /** Gets or sets the hex color used for highlighting hovered joints. */
    get highlightColor(): string { return this.getAttribute('highlight-color') || '#FFFFFF'; }
    set highlightColor(val: string) { val ? this.setAttribute('highlight-color', val) : this.removeAttribute('highlight-color'); }

    constructor() {
        super();

        // Highlight material configuration
        this.highlightMaterial = new THREE.MeshPhongMaterial({
            shininess: 10,
            color: this.highlightColor,
            emissive: this.highlightColor,
            emissiveIntensity: 0.25,
        });

        // Instantiate interactive drag controls
        const el = this.renderer.domElement;
        this.dragControls = new PointerURDFDragControls(this.scene, this.camera, el);

        // Map drag control events to view updates and CustomEvents
        this.dragControls.onDragStart = (joint: URDFJoint) => {
            this.dispatchEvent(new CustomEvent('manipulate-start', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.controls.enabled = false;
            this.redraw();
        };

        this.dragControls.onDragEnd = (joint: URDFJoint) => {
            this.dispatchEvent(new CustomEvent('manipulate-end', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.controls.enabled = true;
            this.redraw();
        };

        this.dragControls.updateJoint = (joint: URDFJoint, angle: number) => {
            this.setJointValue(joint.name, angle);
        };

        this.dragControls.onHover = (joint: URDFJoint) => {
            this._highlightLinkGeometry(joint, false);
            this.dispatchEvent(new CustomEvent('joint-mouseover', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.redraw();
        };

        this.dragControls.onUnhover = (joint: URDFJoint) => {
            this._highlightLinkGeometry(joint, true);
            this.dispatchEvent(new CustomEvent('joint-mouseout', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.redraw();
        };
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.dragControls.dispose();
    }

    override attributeChangedCallback(attr: string, oldval: string, newval: string): void {
        super.attributeChangedCallback(attr, oldval, newval);

        switch (attr) {
            case 'highlight-color':
                this.highlightMaterial.color.set(this.highlightColor);
                this.highlightMaterial.emissive.set(this.highlightColor);
                break;
            case 'disable-dragging':
                this.dragControls.enabled = !this.disableDragging;
                break;
        }
    }
    
    /**
     * Traverses and highlights (or un-highlights) the geometry of the link controlled by a joint.
     * Stops traversal if another joint is encountered to prevent highlighting entire sub-trees.
     * * @param m - The target URDF joint.
     * @param revert - If true, restores original materials. If false, applies highlight material.
     */
    private _highlightLinkGeometry(m: URDFJoint, revert: boolean): void {
        const traverse = (c: THREE.Object3D) => {
            if (c instanceof THREE.Mesh) {
                if (revert) {
                    if (this._originalMaterials.has(c)) {
                        c.material = this._originalMaterials.get(c)!;
                        this._originalMaterials.delete(c);
                    }
                } else {
                    if (!this._originalMaterials.has(c)) {
                        this._originalMaterials.set(c, c.material);
                        c.material = this.highlightMaterial;
                    }
                }
            }

            // Drill down into children, stopping if the next child is another joint
            if (c === m || !isJoint(c)) {
                for (let i = 0; i < c.children.length; i++) {
                    const child = c.children[i];
                    if (!('isURDFCollider' in child)) {
                        traverse(child);
                    }
                }
            }
        };

        traverse(m);
    }
}

// Register the new Web Component
customElements.define('urdf-manipulator', URDFManipulator);