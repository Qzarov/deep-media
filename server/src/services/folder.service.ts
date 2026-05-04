import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetResponseDto, mapAsset } from 'src/dtos/asset-response.dto';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AddFolderUsersDto,
  EffectivePermission,
  FolderAccessMatrixDto,
  FolderBulkAssetsDto,
  FolderCreateDto,
  FolderEffectivePermissionsDto,
  FolderMoveDto,
  FolderRestrictions,
  FolderResponseDto,
  FolderUpdateDto,
  FolderUserInfo,
  FolderWithCounts,
  UpdateFolderUserDto,
  mapFolder,
} from 'src/dtos/folder.dto';
import { FolderEffect, FolderUserRole, FolderUserRoleWeight, Permission } from 'src/enum';
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

  async getAssets(auth: AuthDto, id: string): Promise<AssetResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.FolderRead, ids: [id] });
    const assetIds = await this.folderRepository.getAssetIds(id);
    if (assetIds.length === 0) {
      return [];
    }
    const assets = await this.assetRepository.getByIds(assetIds);
    return assets.map((asset) => mapAsset(asset, { auth }));
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
      role: FolderUserRole.Owner,
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

    const callerPermission = await this.folderUserRepository.getEffectivePermission(id, auth.user.id);
    const callerRole = callerPermission?.role as FolderUserRole | undefined;
    const callerIsOwner = callerRole === FolderUserRole.Owner;

    const existingUsers = await this.folderUserRepository.getByFolderId(id);

    for (const userDto of dto.folderUsers) {
      const { userId, role, effect, restrictions, validFrom, validUntil } = userDto;
      const assignedRole = role ?? FolderUserRole.Editor;

      if (assignedRole === FolderUserRole.Owner) {
        throw new BadRequestException('Cannot add another owner');
      }

      if (assignedRole === FolderUserRole.Administrator && !callerIsOwner) {
        throw new BadRequestException('Only the owner can assign the Administrator role');
      }

      if (effect === FolderEffect.Deny && !callerIsOwner && callerRole !== FolderUserRole.Administrator) {
        throw new BadRequestException('Only Owner or Administrator can set deny entries');
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
        role: assignedRole,
        effect: effect ?? FolderEffect.Allow,
        restrictions: JSON.stringify(restrictions ?? {}),
        validFrom: validFrom ?? null,
        validUntil: validUntil ?? null,
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

    const callerPermission = await this.folderUserRepository.getEffectivePermission(id, auth.user.id);
    const callerRole = callerPermission?.role as FolderUserRole | undefined;
    const callerIsOwner = callerRole === FolderUserRole.Owner;

    if (existing.role === FolderUserRole.Owner && dto.role !== FolderUserRole.Owner) {
      const allUsers = await this.folderUserRepository.getByFolderId(id);
      const owners = allUsers.filter((u) => u.role === FolderUserRole.Owner);
      if (owners.length <= 1) {
        throw new BadRequestException('Cannot change the role of the last owner');
      }
    }

    if (dto.role === FolderUserRole.Administrator && !callerIsOwner) {
      throw new BadRequestException('Only the owner can assign the Administrator role');
    }

    if (dto.effect === FolderEffect.Deny && !callerIsOwner && callerRole !== FolderUserRole.Administrator) {
      throw new BadRequestException('Only Owner or Administrator can set deny entries');
    }

    const updateData: Record<string, unknown> = {};
    if (dto.role !== undefined) {
      updateData.role = dto.role;
    }
    if (dto.effect !== undefined) {
      updateData.effect = dto.effect;
    }
    if (dto.restrictions !== undefined) {
      updateData.restrictions = JSON.stringify(dto.restrictions);
    }
    if (dto.validFrom !== undefined) {
      updateData.validFrom = dto.validFrom;
    }
    if (dto.validUntil !== undefined) {
      updateData.validUntil = dto.validUntil;
    }

    await this.folderUserRepository.update({ folderId: id, userId }, updateData);
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

    if (existing.role === FolderUserRole.Owner) {
      const allUsers = await this.folderUserRepository.getByFolderId(id);
      const owners = allUsers.filter((u) => u.role === FolderUserRole.Owner);
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

  async getEffectivePermissions(auth: AuthDto, id: string): Promise<FolderEffectivePermissionsDto> {
    await this.requireAccess({ auth, permission: Permission.FolderRead, ids: [id] });

    const folder = await this.findOrFail(id);
    const effective = await this.folderUserRepository.getEffectivePermission(id, auth.user.id);

    if (!effective) {
      const isOwner = folder.ownerId === auth.user.id;
      if (isOwner) {
        return this.buildOwnerPermissions(id);
      }
      return this.buildNoAccessPermissions(id);
    }

    const restrictions = this.parseRestrictions(effective.restrictions);
    const role = effective.role as FolderUserRole;
    const effect = effective.effect as FolderEffect;
    const isInherited = effective.depth > 0;

    return {
      folderId: id,
      role: effect === FolderEffect.Deny ? null : role,
      effect,
      isInherited,
      inheritedFrom: isInherited
        ? { folderId: effective.folderId, name: effective.folderName }
        : null,
      restrictions,
      operations: effect === FolderEffect.Deny
        ? { canView: false, canDownload: false, canUpload: false, canEdit: false, canAdmin: false, canDelete: false }
        : this.resolveOperations(role, restrictions),
    };
  }

  async getAccessMatrix(auth: AuthDto, id: string): Promise<FolderAccessMatrixDto> {
    await this.requireAccess({ auth, permission: Permission.FolderShare, ids: [id] });

    const allEntries = await this.folderUserRepository.getAllEffectivePermissions(id);

    const byUser = new Map<string, typeof allEntries[0]>();
    for (const entry of allEntries) {
      if (!byUser.has(entry.userId)) {
        byUser.set(entry.userId, entry);
      }
    }

    const entries = [...byUser.values()].map((entry) => {
      const role = entry.role as FolderUserRole;
      const effect = entry.effect as FolderEffect;
      const restrictions = this.parseRestrictions(entry.restrictions);
      const isInherited = entry.depth > 0;

      return {
        userId: entry.userId,
        name: entry.name,
        email: entry.email,
        profileImagePath: entry.profileImagePath,
        effectiveRole: effect === FolderEffect.Deny ? null : role,
        effect,
        isInherited,
        inheritedFrom: isInherited
          ? { folderId: entry.sourceFolderId, name: entry.sourceFolderName }
          : null,
        restrictions,
        validFrom: entry.validFrom ? String(entry.validFrom) : null,
        validUntil: entry.validUntil ? String(entry.validUntil) : null,
      };
    });

    return { folderId: id, entries };
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
      role: u.role as FolderUserRole,
      effect: (u.effect ?? FolderEffect.Allow) as FolderEffect,
      restrictions: this.parseRestrictions(u.restrictions),
      validFrom: u.validFrom ? String(u.validFrom) : null,
      validUntil: u.validUntil ? String(u.validUntil) : null,
    }));
  }

  private parseRestrictions(raw: unknown): FolderRestrictions {
    if (!raw || typeof raw === 'string') {
      try {
        return raw ? JSON.parse(raw as string) : {};
      } catch {
        return {};
      }
    }
    return raw as FolderRestrictions;
  }

  private resolveOperations(role: FolderUserRole, restrictions: FolderRestrictions) {
    const weight = FolderUserRoleWeight[role];
    return {
      canView: weight >= FolderUserRoleWeight[FolderUserRole.Viewer],
      canDownload: weight >= FolderUserRoleWeight[FolderUserRole.ViewerDownload] && !restrictions.noDownload,
      canUpload: weight >= FolderUserRoleWeight[FolderUserRole.Contributor],
      canEdit: weight >= FolderUserRoleWeight[FolderUserRole.Editor],
      canAdmin: weight >= FolderUserRoleWeight[FolderUserRole.Administrator],
      canDelete: weight >= FolderUserRoleWeight[FolderUserRole.Owner],
    };
  }

  private buildOwnerPermissions(folderId: string): FolderEffectivePermissionsDto {
    return {
      folderId,
      role: FolderUserRole.Owner,
      effect: FolderEffect.Allow,
      isInherited: false,
      inheritedFrom: null,
      restrictions: {},
      operations: { canView: true, canDownload: true, canUpload: true, canEdit: true, canAdmin: true, canDelete: true },
    };
  }

  private buildNoAccessPermissions(folderId: string): FolderEffectivePermissionsDto {
    return {
      folderId,
      role: null,
      effect: FolderEffect.Deny,
      isInherited: false,
      inheritedFrom: null,
      restrictions: {},
      operations: { canView: false, canDownload: false, canUpload: false, canEdit: false, canAdmin: false, canDelete: false },
    };
  }
}
