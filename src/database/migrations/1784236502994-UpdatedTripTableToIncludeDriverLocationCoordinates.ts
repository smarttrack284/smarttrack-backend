import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedTripTableToIncludeDriverLocationCoordinates1784236502994 implements MigrationInterface {
    name = 'UpdatedTripTableToIncludeDriverLocationCoordinates1784236502994'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trips" ADD "driver_location_lat" double precision`);
        await queryRunner.query(`ALTER TABLE "trips" ADD "driver_location_lng" double precision`);
        await queryRunner.query(`ALTER TABLE "trips" ADD "driver_location_updated_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "driver_location_updated_at"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "driver_location_lng"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "driver_location_lat"`);
    }

}
