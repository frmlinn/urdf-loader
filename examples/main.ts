import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { URDFLoader } from '../src/index';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#263238');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(2, 2, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

const pane: any = new Pane({ title: 'T12 Robot Controls' });

const loader = new URDFLoader();
loader.packages = '/urdf'; 

async function loadModel() {
    try {
        const robot = await loader.loadAsync('/urdf/T12/urdf/T12.URDF');
        
        robot.rotation.x = -Math.PI / 2;
        scene.add(robot);

        const jointsFolder = pane.addFolder({ title: 'Joints' });
        
        for (const [name, joint] of Object.entries(robot.joints)) {
            if (joint.jointType !== 'fixed') {
                const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
                const params = { angle: joint.angle };
                
                jointsFolder.addBinding(params, 'angle', {
                    min: limit.lower,
                    max: limit.upper,
                    step: 0.01,
                    label: name
                }).on('change', (ev: { value: number }) => {
                    robot.setJointValue(name, ev.value);
                });
            }
        }
    } catch (error) {
        console.error("Error cargando el URDF T12:", error);
    }
}

loadModel();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});