import { describe, it, expect, vi } from 'vitest';
import { Mesh, BufferGeometry, MeshBasicMaterial, Texture, Material } from 'three';
import { retainResource, releaseResource, retainMeshResources, releaseMeshResources } from '../../src/core/URDFClasses';

type MockResource = { dispose: () => void; userData?: { refCount?: number } };

/**
 * Unit tests for memory management utilities.
 * Validates the Reference Counting system implemented to prevent GPU memory leaks 
 * without relying on JS Garbage Collection.
 */
describe('Memory Management (Reference Counting)', () => {
    it('should properly increment and decrement refCount for a single resource', () => {
        const resource = { dispose: vi.fn() } as MockResource;
        
        retainResource(resource);
        expect(resource.userData?.refCount).toBe(1);
        
        retainResource(resource);
        expect(resource.userData?.refCount).toBe(2);
        
        releaseResource(resource);
        expect(resource.userData?.refCount).toBe(1);
        expect(resource.dispose).not.toHaveBeenCalled();
        
        releaseResource(resource);
        expect(resource.userData?.refCount).toBeUndefined();
        expect(resource.dispose).toHaveBeenCalledOnce();
    });

    it('should handle arrays of resources seamlessly', () => {
        const resA = { dispose: vi.fn() } as MockResource;
        const resB = { dispose: vi.fn() } as MockResource;
        
        retainResource([resA, resB]);
        expect(resA.userData?.refCount).toBe(1);
        expect(resB.userData?.refCount).toBe(1);
        
        releaseResource([resA, resB]);
        expect(resA.dispose).toHaveBeenCalled();
        expect(resB.dispose).toHaveBeenCalled();
    });

    it('should safely ignore null or undefined resources', () => {
        expect(() => retainResource(null)).not.toThrow();
        expect(() => releaseResource(undefined)).not.toThrow();
    });

    it('should retain and release entire Mesh resources (Geometry, Material, Textures)', () => {
        const geometry = new BufferGeometry();
        const texture = new Texture();
        const material = new MeshBasicMaterial({ map: texture });
        const mesh = new Mesh(geometry, material);

        geometry.dispose = vi.fn();
        texture.dispose = vi.fn();
        material.dispose = vi.fn();

        retainMeshResources(mesh);
        
        expect(geometry.userData.refCount).toBe(1);
        expect(material.userData.refCount).toBe(1);
        expect(texture.userData.refCount).toBe(1);

        releaseMeshResources(mesh);

        expect(geometry.dispose).toHaveBeenCalled();
        expect(material.dispose).toHaveBeenCalled();
        expect(texture.dispose).toHaveBeenCalled();
    });

    it('should safely release resources that do not have a dispose method', () => {
        const resource = { userData: { refCount: 1 } } as MockResource;
        
        expect(() => releaseResource(resource)).not.toThrow();
        expect(resource.userData?.refCount).toBeUndefined();
    });

    it('should safely handle retaining and releasing meshes without geometry or materials', () => {
        const mesh = new Mesh();
        
        mesh.geometry = null as unknown as BufferGeometry;
        mesh.material = null as unknown as Material;

        expect(() => retainMeshResources(mesh)).not.toThrow();
        expect(() => releaseMeshResources(mesh)).not.toThrow();
    });

    it('should handle retaining and releasing meshes with an array of materials', () => {
        const geometry = new BufferGeometry();
        const mat1 = new MeshBasicMaterial();
        const mat2 = new MeshBasicMaterial();
        
        const mesh = new Mesh(geometry, [mat1, mat2]);

        retainMeshResources(mesh);
        
        expect(mat1.userData.refCount).toBe(1);
        expect(mat2.userData.refCount).toBe(1);

        releaseMeshResources(mesh);
        
        expect(mat1.userData?.refCount).toBeUndefined();
        expect(mat2.userData?.refCount).toBeUndefined();
    });
});