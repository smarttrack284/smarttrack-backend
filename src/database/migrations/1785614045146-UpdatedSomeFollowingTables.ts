import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedSomeFollowingTables1785614045146 implements MigrationInterface {
    name = 'UpdatedSomeFollowingTables1785614045146'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
