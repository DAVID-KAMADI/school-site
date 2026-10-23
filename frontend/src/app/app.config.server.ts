import { CSP_NONCE, REQUEST_CONTEXT, inject, mergeApplicationConfig, type ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // The per-request nonce from server.ts, so Angular's own inline scripts pass the Content-Security-Policy.
    { provide: CSP_NONCE, useFactory: () => (inject(REQUEST_CONTEXT, { optional: true }) as { cspNonce?: string } | null)?.cspNonce ?? null },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
