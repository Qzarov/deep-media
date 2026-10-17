import { LibraryController } from 'src/controllers/library.controller';
import { LibraryService } from 'src/services/library.service';
import request from 'supertest';
import { factory } from 'test/small.factory';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(LibraryController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(LibraryService);

  beforeAll(async () => {
    ctx = await controllerSetup(LibraryController, [{ provide: LibraryService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /libraries/:id/scan', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post(`/libraries/${factory.uuid()}/scan`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should scan the whole library without a body', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).post(`/libraries/${id}/scan`);
      expect(status).toEqual(204);
      expect(service.queueScan).toHaveBeenCalledWith(id, expect.not.objectContaining({ paths: expect.anything() }));
    });

    it('should pass the paths of a partial scan', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .post(`/libraries/${id}/scan`)
        .send({ paths: ['/mnt/agent/Фото 2025'] });
      expect(status).toEqual(204);
      expect(service.queueScan).toHaveBeenCalledWith(id, { paths: ['/mnt/agent/Фото 2025'] });
    });

    it('should reject an empty list of paths', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/libraries/${factory.uuid()}/scan`)
        .send({ paths: [] });
      expect(status).toEqual(400);
    });
  });

  describe('POST /libraries/:id/assets/move', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post(`/libraries/${factory.uuid()}/assets/move`).send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should accept a batch of items', async () => {
      const id = factory.uuid();
      const assetId = factory.uuid();
      service.moveAssets.mockResolvedValue({ moved: 1, failed: 0, items: [] });
      const { status } = await request(ctx.getHttpServer())
        .post(`/libraries/${id}/assets/move`)
        .send({ items: [{ assetId, toPath: '/mnt/agent/b.jpg' }] });
      expect(status).toEqual(200);
      expect(service.moveAssets).toHaveBeenCalledWith(undefined, id, {
        items: [{ assetId, toPath: '/mnt/agent/b.jpg' }],
      });
    });

    it('should accept a folder prefix', async () => {
      service.moveAssets.mockResolvedValue({ moved: 0, failed: 0, items: [] });
      const { status } = await request(ctx.getHttpServer())
        .post(`/libraries/${factory.uuid()}/assets/move`)
        .send({ fromPrefix: '/mnt/agent/a', toPrefix: '/mnt/agent/b' });
      expect(status).toEqual(200);
    });

    it('should require either items or both prefixes', async () => {
      for (const body of [
        {},
        { fromPrefix: '/mnt/agent/a' },
        { items: [{ toPath: '/mnt/agent/b.jpg' }] },
        { items: [{ assetId: factory.uuid(), fromPath: '/mnt/agent/a.jpg', toPath: '/mnt/agent/b.jpg' }] },
        { items: [{ fromPath: '/mnt/agent/a.jpg', toPath: '/x.jpg' }], fromPrefix: '/a', toPrefix: '/b' },
      ]) {
        const { status } = await request(ctx.getHttpServer())
          .post(`/libraries/${factory.uuid()}/assets/move`)
          .send(body);
        expect(status).toEqual(400);
      }
      expect(service.moveAssets).not.toHaveBeenCalled();
    });
  });
});
