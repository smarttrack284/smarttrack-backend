import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedFollowingTable1785567402478 implements MigrationInterface {
    name = 'UpdatedFollowingTable1785567402478'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_enabled"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "email_team_member_joined"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "team_email_enabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TYPE "public"."user_roles_status_enum" ADD VALUE 'suspended'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."user_roles_status_enum_old" AS ENUM('active', 'invited')`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "status" TYPE "public"."user_roles_status_enum_old" USING "status"::"text"::"public"."user_roles_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."user_roles_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."user_roles_status_enum_old" RENAME TO "user_roles_status_enum"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "team_email_enabled"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "email_team_member_joined" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_enabled" boolean NOT NULL DEFAULT false`);
    }

}
