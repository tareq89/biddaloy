import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextGuard, RolesGuard } from './guards/context.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserTenant } from './entities/user-tenant.entity';
import { User } from '../users/entities/user.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserTenant]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: process.env.JWT_SECRET || configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ContextGuard, RolesGuard],
  exports: [AuthService, JwtModule, PassportModule, ContextGuard, RolesGuard, JwtStrategy],
})
export class AuthModule {}