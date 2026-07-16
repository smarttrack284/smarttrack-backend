import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedUserRoleTableToIncludeInviteHashTokenAndInviteExpiresAt1784203589667 implements MigrationInterface {
    name = 'UpdatedUserRoleTableToIncludeInviteHashTokenAndInviteExpiresAt1784203589667'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "invite_token_hash" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "invite_token_expires_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "invite_token_expires_at"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "invite_token_hash"`);
    }

}
