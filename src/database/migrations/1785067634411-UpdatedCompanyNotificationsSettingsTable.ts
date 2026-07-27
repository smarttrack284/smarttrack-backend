import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedCompanyNotificationsSettingsTable1785067634411 implements MigrationInterface {
    name = 'UpdatedCompanyNotificationsSettingsTable1785067634411'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "email_team_member_invited"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "email_failed_orders"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "email_unassigned_orders"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "email_unassigned_orders" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "email_failed_orders" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "email_team_member_invited" boolean NOT NULL DEFAULT true`);
    }

}
