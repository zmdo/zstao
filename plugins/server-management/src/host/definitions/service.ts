import { Service, type Context } from '@deepseek-ai/cordis'
import type { DefinitionBundle, Registration } from '../../shared/contracts/definitions.ts'
import type { ServerExtensionBundle } from '../../shared/contracts/extensions.ts'
import type { ServerExtensionRuntime } from '../extensions/runtime.ts'
import { ServerExtensionRegistry } from '../extensions/registry.ts'
import { ServerError } from '../../shared/errors.ts'
import { type DefinitionRegistry } from './registry.ts'

export class ServerManagement {
  protected readonly ctx: Context
  private readonly definitions: DefinitionRegistry
  private readonly extensions: ServerExtensionRegistry
  constructor(ctx: Context, definitions: DefinitionRegistry, extensions?: ServerExtensionRegistry) {
    this.ctx = ctx
    this.definitions = definitions
    this.extensions = extensions ?? new ServerExtensionRegistry(definitions)
    Object.defineProperty(this, Service.tracker, { value: { property: 'ctx' } })
  }
  registerServerExtensions(extensions: ServerExtensionBundle, runtime?: ServerExtensionRuntime): Registration {
    const fiber = this.ctx.fiber
    const entry = (fiber as typeof fiber & { entry?: { options: { name?: string } } }).entry
    const owner = entry?.options.name ?? fiber.runtime?.name
    if (owner !== extensions.owner) throw new ServerError('definition_owner')
    let registration: Registration
    const dispose = this.ctx.effect(() => {
      registration = this.extensions.registerExtensions(extensions, fiber, runtime)
      return async () => {
        await registration.dispose()
      }
    }, 'serverManagement.registerServerExtensions()')
    return {
      ready: registration!.ready,
      dispose: async () => {
        await dispose()
      },
    }
  }

  registerDefinitions(definition: DefinitionBundle): Registration {
    const fiber = this.ctx.fiber
    const entry = (fiber as typeof fiber & { entry?: { options: { name?: string } } }).entry
    const owner = entry?.options.name ?? fiber.runtime?.name
    if (owner !== definition.owner) throw new ServerError('definition_owner')
    let registration: Registration
    const dispose = this.ctx.effect(() => {
      registration = this.definitions.registerDefinitions(definition, fiber)
      return async () => {
        await registration.dispose()
      }
    }, 'serverManagement.registerDefinitions()')
    return {
      ready: registration!.ready,
      dispose: async () => {
        await dispose()
      },
    }
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    serverManagement: ServerManagement
  }
}
