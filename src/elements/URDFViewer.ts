import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { URDFLoader } from '../core/URDFLoader';
import { URDFRobot } from '../core/URDFClasses';

export class URDFViewer extends HTMLElement {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;
    public robot: URDFRobot | null = null;
    public loader: URDFLoader;

    private reqId: number = 0;
    private resizeObserver: ResizeObserver;

    static get observedAttributes() {
        return ['urdf', 'up'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            :host { display: block; width: 100%; height: 100%; position: relative; overflow: hidden; }
            canvas { display: block; width: 100%; height: 100%; outline: none; }
        `;
        this.shadowRoot!.appendChild(style);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.camera.position.set(2, 2, 2);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.shadowRoot!.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        
        const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(5, 5, 5);
        this.scene.add(dirLight);

        this.loader = new URDFLoader();
        this.resizeObserver = new ResizeObserver(() => this.resize());
    }

    connectedCallback() {
        this.resizeObserver.observe(this);
        this.renderLoop();
    }

    disconnectedCallback() {
        this.resizeObserver.disconnect();
        cancelAnimationFrame(this.reqId);
        this.renderer.dispose();
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (oldValue === newValue) return;
        if (name === 'urdf' && newValue) this.loadURDF(newValue);
        else if (name === 'up') this.setUpAxis(newValue);
    }

    private async loadURDF(url: string) {
        if (this.robot) {
            this.scene.remove(this.robot);
            this.robot = null;
        }

        try {
            this.loader.packages = '/urdf';
            this.robot = await this.loader.loadAsync(url);
            this.setUpAxis(this.getAttribute('up') || 'Z');
            this.scene.add(this.robot);
            
            this.dispatchEvent(new CustomEvent('urdf-loaded', { detail: this.robot }));
        } catch (error) {
            console.error('URDFViewer: Error loading URDF', error);
            this.dispatchEvent(new CustomEvent('urdf-error', { detail: error }));
        }
    }

    private setUpAxis(axis: string) {
        if (!this.robot) return;
        this.robot.rotation.set(0, 0, 0);
        if (axis.toUpperCase() === 'Z') this.robot.rotation.x = -Math.PI / 2;
    }

    private resize() {
        if (this.clientWidth === 0 || this.clientHeight === 0) return;
        this.renderer.setSize(this.clientWidth, this.clientHeight, false);
        this.camera.aspect = this.clientWidth / this.clientHeight;
        this.camera.updateProjectionMatrix();
    }

    private renderLoop = () => {
        this.reqId = requestAnimationFrame(this.renderLoop);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

customElements.define('urdf-viewer', URDFViewer);