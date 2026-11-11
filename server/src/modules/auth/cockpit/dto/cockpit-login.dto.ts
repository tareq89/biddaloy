import { LoginDto } from '../../dto/login.dto';

/** Same shape and rules as the app login: email or phone, plus password. */
export class CockpitLoginDto extends LoginDto {}
