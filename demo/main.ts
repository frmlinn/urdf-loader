import * as THREE from 'three';
// Importamos el Web Component para que se registre en el navegador
import '../src/elements/URDFManipulator';
import { URDFManipulator } from '../src/elements/URDFManipulator';

const viewer = document.querySelector('urdf-manipulator') as URDFManipulator;
const animToggle = document.getElementById('anim-toggle') as HTMLInputElement;

// --- Paso 2: Control de Estado ---
let isAnimating = false;

if (viewer && animToggle) {

    // --- Paso 4: Eventos de Interacción (UX) ---
    
    // Escuchar el cambio en el checkbox de la UI
    animToggle.addEventListener('change', (e) => {
        isAnimating = (e.target as HTMLInputElement).checked;
    });

    // Interrupción UX: Si el usuario agarra una articulación, paramos la animación
    viewer.addEventListener('manipulate-start', () => {
        if (isAnimating) {
            isAnimating = false;
            animToggle.checked = false;
        }
    });

    // Log opcional para saber cuándo el robot está completamente listo
    viewer.addEventListener('geometry-loaded', () => {
        console.log('🤖 Modelo T12 cargado y renderizado con éxito.');
    });

    // --- Paso 3: Lógica Matemática y Bucle de Animación ---
    
    // Usamos el 'time' de alta resolución inyectado por requestAnimationFrame
    const animationLoop = (time: number) => {
        // Encolamos el siguiente frame inmediatamente
        requestAnimationFrame(animationLoop);

        // Solo procesamos la matemática si la animación está activa y el robot existe
        if (!isAnimating || !viewer.robot) return;

        // Escalamos el tiempo para que la velocidad coincida con la lógica original (Date.now() / 3e2)
        const timeScaled = time / 300; 

        // El robot T12 tiene 6 patas, iteramos sobre ellas
        for (let i = 1; i <= 6; i++) {
            
            // Calculamos el desfase de la ola para que parezca que camina/pedalea
            const offset = (i * Math.PI) / 3;
            const ratio = Math.max(0, Math.sin(timeScaled + offset));

            // Interpolamos y aplicamos los valores directamente usando nuestro método reactivo setJointValue
            // Piernas (ángulos en radianes)
            viewer.setJointValue(`HP${i}`, THREE.MathUtils.lerp(30, 0, ratio) * THREE.MathUtils.DEG2RAD);
            viewer.setJointValue(`KP${i}`, THREE.MathUtils.lerp(90, 150, ratio) * THREE.MathUtils.DEG2RAD);
            viewer.setJointValue(`AP${i}`, THREE.MathUtils.lerp(-30, -60, ratio) * THREE.MathUtils.DEG2RAD);

            // Dedos/Tarsos (movimiento lineal o pequeño desplazamiento)
            viewer.setJointValue(`TC${i}A`, THREE.MathUtils.lerp(0, 0.065, ratio));
            viewer.setJointValue(`TC${i}B`, THREE.MathUtils.lerp(0, 0.065, ratio));

            // Ruedas (Rotación continua basada puramente en el tiempo transcurrido)
            viewer.setJointValue(`W${i}`, time * 0.001);
        }
    };

    // Iniciamos el bucle infinito (aunque la matemática solo se ejecuta si isAnimating === true)
    requestAnimationFrame(animationLoop);
}