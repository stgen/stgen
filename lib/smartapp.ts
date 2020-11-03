import { SmartApp, SmartAppOptions, SmartAppContext } from '@smartthings/smartapp';
import { AppEvent } from '@smartthings/smartapp/lib/lifecycle-events';
import { UnknownCapability } from './device';
import { StatusType, Select, ValueOf } from './utils';

const STGEN_EVENT_PREFIX = 'stgen-smartapp-events';

export interface EventType<
  TCapability extends UnknownCapability,
  attribute extends keyof StatusType<TCapability>
> extends AppEvent.DeviceEvent {
  attribute: Extract<attribute, string>;
  capability: Select<TCapability, 'id'>;
  value: ValueOf<StatusType<TCapability>, attribute>;
}

/**
 * Provides a pre-configured SmartApp for use with STGen.
 */
export class STGenSmartApp extends SmartApp {
  private subscribedCapabilities = new Set<string>();
  private callbacks = new Set<(context: SmartAppContext, event: AppEvent.DeviceEvent) => void>();
  constructor(options?: SmartAppOptions) {
    super(options);
    this.appId('stgen-smartapp')
      .permissions([
        'r:devices:*',
        'w:devices:*',
        'x:devices:*',
        'r:locations:*',
        'r:scenes:*',
        'x:scenes:*',
      ])
      .page('mainPage', async (context, page) => {
        page.name('STGen');
        page.section('Instructions', section => {
          section.name('Instructions');
          section.paragraphSetting('instructions').name('Instructions').description(` \
                This is your STGen personal automation SmartApp. \
                There are no settings -- you just write and deploy your backend code by \
                following the instructions in the Github repository below.`);
          section
            .linkSetting('github')
            .name('Github')
            .url('https://github.com/stgen/stgen-smartapp')
            .description('STGen SmartApp Github Repository');
        });
      })
      .updated(async context => {
        await context.api.subscriptions.delete();
        for (const cap of this.subscribedCapabilities) {
          const sub = await context.api.subscriptions.subscribeToCapability(
            cap,
            '*',
            `${STGEN_EVENT_PREFIX}_${cap}`
          );
          console.log(sub);
        }
      })
      .subscribedEventHandler(STGEN_EVENT_PREFIX, (context, event) => {
        for (const callback of this.callbacks) {
          callback(context, event);
        }
      });
  }

  subscribe<TCapability extends UnknownCapability>(
    capability: TCapability,
    callback: (context: SmartAppContext, event: AppEvent.DeviceEvent) => void
  ): this {
    this.callbacks.add((context, event) => {
      if (
        event.capability == capability.id &&
        event.componentId == capability.component.id &&
        event.deviceId == capability.device.id
      ) {
        callback(context, event);
      }
    });
    this.subscribedCapabilities.add(capability.id);
    return this;
  }

  subscribeAll(
    capabilities: UnknownCapability[],
    callback: (context: SmartAppContext, event: AppEvent.DeviceEvent) => void
  ): this {
    capabilities.forEach(cap => this.subscribe(cap, callback));
    return this;
  }
}
