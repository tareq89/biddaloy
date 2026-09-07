import { ProvisionSchoolAdminDto } from '../../provisioning/dto/provision-school.dto';

/**
 * `POST /schools/:id/admins` (#531). Identical shape and validation to
 * `POST /schools`'s nested `admin` (#529) — both feed
 * `ProvisioningService.provisionAdminForSchool` — so it extends
 * `ProvisionSchoolAdminDto` rather than re-declaring the fields and the
 * email-or-phone constraint. Kept as its own class so the OpenAPI schema
 * name stays `AddSchoolAdminDto` for the generated client types.
 */
export class AddSchoolAdminDto extends ProvisionSchoolAdminDto {}
