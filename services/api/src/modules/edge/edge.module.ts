import { Module } from '@nestjs/common';

import { EdgeAuthController, EdgeTokenVerifier } from './edge-auth.controller';

@Module({
  controllers: [EdgeAuthController],
  providers: [EdgeTokenVerifier],
  exports: [EdgeTokenVerifier],
})
export class EdgeModule {}
