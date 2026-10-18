import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { UserStatus } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SessionRepository } from 'src/repositories/session.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { TelemetryRepository } from 'src/repositories/telemetry.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AuthService } from 'src/services/auth.service';
import { UserAdminService } from 'src/services/user-admin.service';
import { newMediumService } from 'test/medium.factory';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { getKyselyDB } from 'test/utils';

const serviceToken = 'medium-test-service-token';

let defaultDatabase: Kysely<DB>;

const options = (db: Kysely<DB>) => ({
  database: db,
  real: [
    AccessRepository,
    CryptoRepository,
    DatabaseRepository,
    SessionRepository,
    SystemMetadataRepository,
    UserRepository,
  ],
  mock: [ConfigRepository, LoggingRepository, StorageRepository, EventRepository, TelemetryRepository],
});

const setup = (db?: Kysely<DB>) => {
  const auth = newMediumService(AuthService, options(db || defaultDatabase));
  const userAdmin = newMediumService(UserAdminService, options(db || defaultDatabase));
  for (const { ctx } of [auth, userAdmin]) {
    ctx.getMock(ConfigRepository).getEnv.mockReturnValue(mockEnvData({ qspace: { serviceToken } }));
    ctx.getMock(EventRepository).emit.mockResolvedValue();
  }
  return { auth, userAdmin };
};

const serviceRequest = (userId: string, adminRoute = false) => ({
  headers: { authorization: `Bearer ${serviceToken}`, 'x-qspace-user': userId },
  queryParams: {},
  metadata: { adminRoute, sharedLinkRoute: false, uri: 'test' },
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('Q Space service users', () => {
  it('should create a user with the given id and authenticate as that user until it is deleted', async () => {
    const { auth, userAdmin } = setup();
    const { user: admin } = await auth.ctx.newUser({ isAdmin: true });

    const adminAuth = await auth.sut.authenticate(serviceRequest(admin.id, true));
    expect(adminAuth).toEqual(expect.objectContaining({ qspaceService: true }));

    const id = randomUUID();
    const created = await userAdmin.sut.create(adminAuth, {
      id,
      email: `${id}@immich.cloud`,
      name: 'Hub user',
      password: randomUUID(),
    });
    expect(created.id).toBe(id);

    await expect(auth.sut.authenticate(serviceRequest(id))).resolves.toEqual({
      user: expect.objectContaining({ id, isAdmin: false }),
      qspaceService: true,
    });

    await expect(
      userAdmin.sut.create(adminAuth, { id, email: `other-${id}@immich.cloud`, name: 'Again', password: 'x' }),
    ).rejects.toThrow(BadRequestException);

    await auth.ctx.get(UserRepository).update(id, { deletedAt: new Date(), status: UserStatus.Deleted });
    await expect(auth.sut.authenticate(serviceRequest(id))).rejects.toThrow(UnauthorizedException);
  });

  it('should reject a wrong service token', async () => {
    const { auth } = setup();
    const { user } = await auth.ctx.newUser();
    const request = serviceRequest(user.id);
    request.headers.authorization = 'Bearer wrong-token';

    await expect(auth.sut.authenticate(request)).rejects.toThrow(UnauthorizedException);
  });
});
