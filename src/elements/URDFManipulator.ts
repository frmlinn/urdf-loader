import * as THREE from 'three';
import { URDFViewer } from './URDFViewer';
import { PointerURDFDragControls } from '../core/URDFDragControls';
import { URDFJoint } from '../core/URDFClasses';

export class URDFManipulator extends URDFViewer {
    public dragControls: PointerURDFDragControls;
    public highlightMaterial: THREE.MeshPhongMaterial;

    // Usamos un WeakMap para almacenar de forma segura los materiales originales
    // sin contaminar la clase THREE.Mesh con propiedades dinámicas (tipo "any").
    private _originalMaterials: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]> = new WeakMap();

    static get observedAttributes() {
        return ['highlight-color', 'disable-dragging', ...super.observedAttributes];
    }

    // --- Atributos Reactivos Propios ---

    get disableDragging(): boolean { return this.hasAttribute('disable-dragging'); }
    set disableDragging(val: boolean) { val ? this.setAttribute('disable-dragging', 'true') : this.removeAttribute('disable-dragging'); }

    get highlightColor(): string { return this.getAttribute('highlight-color') || '#FFFFFF'; }
    set highlightColor(val: string) { val ? this.setAttribute('highlight-color', val) : this.removeAttribute('highlight-color'); }

    constructor() {
        super();

        // Configuración del material de resaltado
        this.highlightMaterial = new THREE.MeshPhongMaterial({
            shininess: 10,
            color: this.highlightColor,
            emissive: this.highlightColor,
            emissiveIntensity: 0.25,
        });

        const isJoint = (j: any): j is URDFJoint => {
            return j && j.isURDFJoint && j.jointType !== 'fixed';
        };

        // Función para resaltar la geometría del Link bajo una articulación
        const highlightLinkGeometry = (m: URDFJoint, revert: boolean) => {
            const traverse = (c: THREE.Object3D) => {
                // Configurar o revertir el color de resaltado
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

                // Profundizar en los hijos y detenerse si el siguiente hijo es otra articulación
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
        };

        // Instanciar los controles interactivos de arrastre
        const el = this.renderer.domElement;
        this.dragControls = new PointerURDFDragControls(this.scene, this.camera, el);

        // Mapeo de eventos del DragControls a la vista y despacho de CustomEvents
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
            highlightLinkGeometry(joint, false);
            this.dispatchEvent(new CustomEvent('joint-mouseover', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.redraw();
        };

        this.dragControls.onUnhover = (joint: URDFJoint) => {
            highlightLinkGeometry(joint, true);
            this.dispatchEvent(new CustomEvent('joint-mouseout', { bubbles: true, cancelable: true, composed: true, detail: joint.name }));
            this.redraw();
        };
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        this.dragControls.dispose();
    }

    override attributeChangedCallback(attr: string, oldval: string, newval: string) {
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
}

// Registrar el nuevo Web Component
customElements.define('urdf-manipulator', URDFManipulator);