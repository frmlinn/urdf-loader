// Importamos el Web Component para que se registre en el navegador
import '../src/elements/URDFManipulator';

const viewer = document.querySelector('urdf-manipulator');

if (viewer) {
    // Escuchamos cuando el robot se ha procesado con éxito
    viewer.addEventListener('urdf-processed', () => {
        console.log('🤖 Robot cargado y procesado exitosamente.');
    });

    // Escuchamos la interacción física
    viewer.addEventListener('manipulate-start', (e: Event) => {
        const customEvent = e as CustomEvent<string>;
        console.log(`Pillada la articulación: ${customEvent.detail}`);
    });

    viewer.addEventListener('manipulate-end', (e: Event) => {
        const customEvent = e as CustomEvent<string>;
        console.log(`Soltada la articulación: ${customEvent.detail}`);
    });

    // Opcional: Escuchar los cambios de ángulo en tiempo real (puede haber spam en consola)
    /*
    viewer.addEventListener('angle-change', (e: Event) => {
        const customEvent = e as CustomEvent<string>;
        const jointName = customEvent.detail;
        const currentAngle = viewer.angles[jointName];
        console.log(`Articulación ${jointName} -> Ángulo: ${currentAngle}`);
    });
    */
}