import { BadRequestException, Injectable } from '@nestjs/common';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AddFolderUsersDto,
  FolderBulkAssetsDto,
  FolderCreateDto,
  FolderMoveDto,
  FolderResponseDto,
  FolderUpdateDto,
  FolderUserInfo,
  FolderWithCounts,
  UpdateFolderUserDto,
  mapFolder,
} from 'src/dtos/folder.dto';
import { AlbumUserRole, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';

@Injectable()
export class FolderService extends BaseService {
  async getAll(auth: AuthDto): Promise<FolderResponseDto[]> {
    const folders = await this.folderRepository.getRootFolders(auth.user.id);
    return folders.map((f) => mapFolder(f));
  }

  async get(auth: AuthDto, id: string): Promise<FolderResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FolderRead, ids: [id] });
    const folder = await this.findOrFail(id);
    const users = await this.getFolderUsers(id);
    return mapFolder(folder, users);
  }

  async getChildren(auth: AuthDto, id: string): Promise<FolderResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.FolderRead, ids: [id] });
    const children = await this.folderRepository.getChildren(id);
    return children.map((f) => mapFolder(f));
  }

  async getBreadcrumbs(auth: AuthDto, id: string) {
    await this.requireAccess({ auth, permission: Permission.FolderRead, ids: [id] });
    return this.folderRepository.getBreadcrumbs(id);
  }

  async create(auth: AuthDto, dto: FolderCreateDto): Promise<FolderResponseDto> {
    if (dto.parentId) {
      await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [dto.parentId] });
    }

    const duplicate = await this.folderRepository.checkDuplicateName(auth.user.id, dto.parentId ?? null, dto.name);
    if (duplicate) {
      throw new BadRequestException('A folder with that name already exists in this location');
    }

    const created = await this.folderRepository.create({
      ownerId: auth.user.id,
      name: dto.name,
      description: dto.description ?? '',
      parentId: dto.parentId ?? null,
    });

    await this.folderUserRepository.create({
      folderId: created.id,
      userId: auth.user.id,
      role: AlbumUserRole.Owner,
    });

    const folder = await this.findOrFail(created.id);
    const users = await this.getFolderUsers(created.id);
    return mapFolder(folder, users);
  }

  async update(auth: AuthDto, id: string, dto: FolderUpdateDto): Promise<FolderResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [id] });

    const existing = await this.folderRepository.get(id);
    if (!existing) {
      throw new BadRequestException('Folder not found');
    }

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.folderRepository.checkDuplicateName(existing.ownerId, existing.parentId, dto.name);
      if (duplicate) {
        throw new BadRequestException('A folder with that name already exists in this location');
      }
    }

    await this.folderRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });

    const folder = await this.findOrFail(id);
    const users = await this.getFolderUsers(id);
    return mapFolder(folder, users);
  }

  async move(auth: AuthDto, id: string, dto: FolderMoveDto): Promise<FolderResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [id] });

    if (dto.parentId) {
      await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [dto.parentId] });

      if (dto.parentId === id) {
        throw new BadRequestException('Cannot move folder into itself');
      }

      const isDescendant = await this.folderRepository.isDescendantOf(dto.parentId, id);
      if (isDescendant) {
        throw new BadRequestException('Cannot move folder into its own descendant');
      }
    }

    const existing = await this.folderRepository.get(id);
    if (!existing) {
      throw new BadRequestException('Folder not found');
    }

    const duplicate = await this.folderRepository.checkDuplicateName(existing.ownerId, dto.parentId, existing.name);
    if (duplicate) {
      throw new BadRequestException('A folder with that name already exists in the target location');
    }

    await this.folderRepository.move(id, dto.parentId);

    const folder = await this.findOrFail(id);
    return mapFolder(folder);
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FolderDelete, ids: [id] });
    await this.folderRepository.softDelete(id);
  }

  async addUsers(auth: AuthDto, id: string, dto: AddFolderUsersDto): Promise<FolderResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FolderShare, ids: [id] });

    const existingUsers = await this.folderUserRepository.getByFolderId(id);

    for (const { userId, role } of dto.folderUsers) {
      if (role === AlbumUserRole.Owner) {
        throw new BadRequestException('Cannot add another owner');
      }

      const exists = existingUsers.find((u) => u.userId === userId);
      if (exists) {
        throw new BadRequestException('User already added');
      }

      const user = await this.userRepository.get(userId, { withDeleted: false });
      if (!user) {
        throw new BadRequestException('User not found');
      }

      await this.folderUserRepository.create({
        folderId: id,
        userId,
        role: role ?? AlbumUserRole.Editor,
      });
    }

    const folder = await this.findOrFail(id);
    const users = await this.getFolderUsers(id);
    return mapFolder(folder, users);
  }

  async updateUser(auth: AuthDto, id: string, userId: string, dto: UpdateFolderUserDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FolderShare, ids: [id] });

    const existing = await this.folderUserRepository.getByFolderAndUser(id, userId);
    if (!existing) {
      throw new BadRequestException('User not found in folder');
    }

    if (existing.role === AlbumUserRole.Owner && dto.role !== AlbumUserRole.Owner) {
      const allUsers = await this.folderUserRepository.getByFolderId(id);
      const owners = allUsers.filter((u) => u.role === AlbumUserRole.Owner);
      if (owners.length <= 1) {
        throw new BadRequestException('Cannot change the role of the last owner');
      }
    }

    await this.folderUserRepository.update({ folderId: id, userId }, { role: dto.role });
  }

  async removeUser(auth: AuthDto, id: string, userId: string): Promise<void> {
    const isSelf = auth.user.id === userId;

    if (!isSelf) {
      await this.requireAccess({ auth, permission: Permission.FolderShare, ids: [id] });
    }

    const existing = await this.folderUserRepository.getByFolderAndUser(id, userId);
    if (!existing) {
      throw new BadRequestException('User not found in folder');
    }

    if (existing.role === AlbumUserRole.Owner) {
      const allUsers = await this.folderUserRepository.getByFolderId(id);
      const owners = allUsers.filter((u) => u.role === AlbumUserRole.Owner);
      if (owners.length <= 1) {
        throw new BadRequestException('Cannot remove the last folder owner');
      }
    }

    await this.folderUserRepository.delete({ folderId: id, userId });
  }

  async addAssets(auth: AuthDto, id: string, dto: FolderBulkAssetsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [id] });

    const results: BulkIdResponseDto[] = [];
    const validAssetIds = await this.checkAccess({ auth, permission: Permission.AssetRead, ids: dto.assetIds });

    for (const assetId of dto.assetIds) {
      if (validAssetIds.has(assetId)) {
        results.push({ id: assetId, success: true });
      } else {
        results.push({ id: assetId, success: false, error: BulkIdErrorReason.NO_PERMISSION });
      }
    }

    const toAdd = results.filter((r) => r.success).map((r) => r.id);
    if (toAdd.length > 0) {
      await this.folderRepository.addAssetIds(id, toAdd);
    }

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.FolderUpdate, ids: [id] });

    await this.folderRepository.removeAssetIds(id, dto.ids);

    return dto.ids.map((assetId) => ({ id: assetId, success: true }));
  }

  private async findOrFail(id: string): Promise<FolderWithCounts> {
    const folder = await this.folderRepository.getWithCounts(id);
    if (!folder) {
      throw new BadRequestException('Folder not found');
    }
    return folder;
  }

  private async getFolderUsers(folderId: string): Promise<FolderUserInfo[]> {
    const users = await this.folderUserRepository.getByFolderId(folderId);
    return users.map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      profileImagePath: u.profileImagePath,
      role: u.role as AlbumUserRole,
    }));
  }
}
