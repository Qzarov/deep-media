import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AssetResponseDto } from 'src/dtos/asset-response.dto';
import { BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AddFolderUsersDto,
  FolderAccessMatrixDto,
  FolderBulkAssetsDto,
  FolderCreateDto,
  FolderEffectivePermissionsDto,
  FolderMoveDto,
  FolderResponseDto,
  FolderUpdateDto,
  UpdateFolderUserDto,
} from 'src/dtos/folder.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { FolderService } from 'src/services/folder.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Folders)
@Controller('folders')
export class FolderController {
  constructor(private service: FolderService) {}

  @Post()
  @Authenticated({ permission: Permission.FolderCreate })
  @Endpoint({
    summary: 'Create a folder',
    description: 'Create a new folder with optional parent for nested hierarchy.',
    history: new HistoryBuilder().added('v2'),
  })
  createFolder(@Auth() auth: AuthDto, @Body() dto: FolderCreateDto): Promise<FolderResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get root folders',
    description: 'Retrieve all root-level folders for the authenticated user.',
    history: new HistoryBuilder().added('v2'),
  })
  getRootFolders(@Auth() auth: AuthDto): Promise<FolderResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get folder',
    description: 'Retrieve a specific folder by its ID, including sharing information.',
    history: new HistoryBuilder().added('v2'),
  })
  getFolder(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<FolderResponseDto> {
    return this.service.get(auth, id);
  }

  @Get(':id/children')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get child folders',
    description: 'Retrieve all direct child folders of a specific folder.',
    history: new HistoryBuilder().added('v2'),
  })
  getChildren(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<FolderResponseDto[]> {
    return this.service.getChildren(auth, id);
  }

  @Get(':id/breadcrumbs')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get folder breadcrumbs',
    description: 'Retrieve the ancestor chain from root to this folder.',
    history: new HistoryBuilder().added('v2'),
  })
  getBreadcrumbs(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto) {
    return this.service.getBreadcrumbs(auth, id);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.FolderUpdate })
  @Endpoint({
    summary: 'Update a folder',
    description: 'Update folder name or description.',
    history: new HistoryBuilder().added('v2'),
  })
  updateFolder(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FolderUpdateDto,
  ): Promise<FolderResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Put(':id/move')
  @Authenticated({ permission: Permission.FolderUpdate })
  @Endpoint({
    summary: 'Move a folder',
    description: 'Move a folder to a new parent, or to root (parentId: null).',
    history: new HistoryBuilder().added('v2'),
  })
  moveFolder(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FolderMoveDto,
  ): Promise<FolderResponseDto> {
    return this.service.move(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.FolderDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a folder',
    description: 'Soft-delete a folder and all its subfolders. Only owner can delete.',
    history: new HistoryBuilder().added('v2'),
  })
  deleteFolder(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.remove(auth, id);
  }

  @Get(':id/assets')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get folder assets',
    description: 'Retrieve all assets in a folder.',
    history: new HistoryBuilder().added('v2'),
  })
  getAssets(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AssetResponseDto[]> {
    return this.service.getAssets(auth, id);
  }

  @Put(':id/assets')
  @Authenticated({ permission: Permission.FolderUpdate })
  @Endpoint({
    summary: 'Add assets to folder',
    description: 'Add multiple assets to a folder. Requires editor access or higher.',
    history: new HistoryBuilder().added('v2'),
  })
  addAssets(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FolderBulkAssetsDto,
  ): Promise<BulkIdResponseDto[]> {
    return this.service.addAssets(auth, id, dto);
  }

  @Delete(':id/assets')
  @Authenticated({ permission: Permission.FolderUpdate })
  @Endpoint({
    summary: 'Remove assets from folder',
    description: 'Remove multiple assets from a folder. Requires editor access or higher.',
    history: new HistoryBuilder().added('v2'),
  })
  removeAssets(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: BulkIdsDto,
  ): Promise<BulkIdResponseDto[]> {
    return this.service.removeAssets(auth, id, dto);
  }

  @Get(':id/permissions')
  @Authenticated({ permission: Permission.FolderRead })
  @Endpoint({
    summary: 'Get effective permissions',
    description: 'Get the effective ACL permissions for the current user on this folder, resolving inheritance.',
    history: new HistoryBuilder().added('v2'),
  })
  getEffectivePermissions(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<FolderEffectivePermissionsDto> {
    return this.service.getEffectivePermissions(auth, id);
  }

  @Get(':id/access-matrix')
  @Authenticated({ permission: Permission.FolderShare })
  @Endpoint({
    summary: 'Get access matrix',
    description: 'Get all users with access to this folder and their effective permissions. Requires administrator access.',
    history: new HistoryBuilder().added('v2'),
  })
  getAccessMatrix(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<FolderAccessMatrixDto> {
    return this.service.getAccessMatrix(auth, id);
  }

  @Put(':id/users')
  @Authenticated({ permission: Permission.FolderUserCreate })
  @Endpoint({
    summary: 'Share folder with users',
    description: 'Add users to a folder with specified roles. Permissions inherit to subfolders.',
    history: new HistoryBuilder().added('v2'),
  })
  addUsers(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AddFolderUsersDto,
  ): Promise<FolderResponseDto> {
    return this.service.addUsers(auth, id, dto);
  }

  @Put(':id/user/:userId')
  @Authenticated({ permission: Permission.FolderUserUpdate })
  @Endpoint({
    summary: 'Update user role in folder',
    description: 'Change the role of a user in a folder.',
    history: new HistoryBuilder().added('v2'),
  })
  updateUser(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Param('userId') userId: string,
    @Body() dto: UpdateFolderUserDto,
  ): Promise<void> {
    return this.service.updateUser(auth, id, userId, dto);
  }

  @Delete(':id/user/:userId')
  @Authenticated({ permission: Permission.FolderUserDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove user from folder',
    description: 'Remove a user from a folder, or leave the folder yourself.',
    history: new HistoryBuilder().added('v2'),
  })
  removeUser(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.service.removeUser(auth, id, userId);
  }
}
