import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { JwtPayload, JwtMembership, LoginResponse } from '@beton-boi/shared';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepository: Repository<UserTenant>,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(emailOrPhone: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: [
        { email: emailOrPhone },
        { phone: emailOrPhone },
      ],
    });

    if (!user || !user.password_hash) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(emailOrPhone: string, password: string): Promise<LoginResponse> {
    const user = await this.validateUser(emailOrPhone, password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Fetch all memberships for this user
    const memberships = await this.userTenantRepository.find({
      where: { user_id: user.id },
    });

    const membershipPayload: JwtMembership[] = memberships.map((m) => ({
      tenantId: m.tenant_id,
      role: m.role,
    }));

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      memberships: membershipPayload,
    };

    // Update last login timestamp
    user.last_login_at = new Date();
    await this.userRepository.save(user);

    return {
      access_token: this.jwtService.sign(payload),
      memberships: membershipPayload,
    };
  }
}