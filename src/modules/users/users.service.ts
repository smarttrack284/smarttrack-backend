import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { TeamRoleType } from '#/common/types/team-role.type';
import {
  ResourceConflictException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '#/common/supabase/supabase.module';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Creates a role assignment linking a user to a company. Used both
   * standalone (inviting/promoting a team member) and as a step inside
   * another service's transaction — most importantly,
   * CompaniesService.createCompany should call this with its own `manager`
   * to atomically create the company AND its first owner's role in one
   * transaction, so a company can never exist with zero owners.
   */
  async createUserRole(
    input: {
      userId: string;
      companyId: string;
      name: string;
      role: TeamRoleType;
    },
    manager?: EntityManager,
  ): Promise<UserRole> {
    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(UserRole);

      const existing = await repo.findOne({
        where: { userId: input.userId, companyId: input.companyId },
      });
      if (existing) {
        throw new ResourceConflictException(
          'This user already has a role in this company',
        );
      }

      const userRole = repo.create(input);
      return repo.save(userRole);
    });
  }

  async getUserRole(
    userId: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<UserRole> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const userRole = await repo.findOne({ where: { userId, companyId } });
    if (!userRole) {
      throw new ResourceNotFoundException('UserRole');
    }
    return userRole;
  }

  /**
   * Looks up a user directly from Supabase Auth by their user ID, using
   * the Admin API — this is NOT the same as reading your own `user_roles`
   * table. Use this when you need Supabase's own record of a user (email,
   * email_confirmed_at, user_metadata like full_name, etc.), e.g. to pull
   * `ownerName` for CompaniesService.createCompany once a real auth guard
   * exists and only has a userId to work with.
   *
   * Requires the service-role Supabase client (SUPABASE_CLIENT) — never
   * expose this method's result wholesale to a client response, since the
   * Supabase User object can include fields you may not want to leak
   * (identity provider details, etc.). Map to only what you need at the
   * call site.
   */
  async getUserFromSupabase(userId: string): Promise<User> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);

    if (error || !data?.user) {
      throw new ResourceNotFoundException('User', userId);
    }

    return data.user;
  }

  /**
   * Same pattern as CompaniesService.withTransaction — participates in an
   * already-open transaction if `manager` is passed (e.g. from
   * CompaniesService.createCompany, so a company and its owner's role are
   * created atomically), otherwise owns its own QueryRunner lifecycle.
   */
  private async withTransaction<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager) {
      return work(manager);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
