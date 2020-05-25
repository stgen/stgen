import moduleAlias from 'module-alias';
moduleAlias.addAlias('stgen', `${__dirname}/../../lib/index`);

import assert from 'assert';
import fs from 'fs';
import { SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import { virtualDimmer } from '../../gen/devices';

describe('Rich Requests', function () {
    let client: SmartThingsClient;
    before(function () {
        client = new SmartThingsClient(
            new BearerTokenAuthenticator(fs.readFileSync('accessToken', 'utf-8')));
    });
    it('Can get capability status', async function () {
        let status = await virtualDimmer(client).main.switch.getStatus();
        assert(status.switch.value);
    });
    it('Can get component status', async function() {
        let status = await virtualDimmer(client).main.getStatus();
        assert(status.switch.switch.value);
    });
    it('Can get device status', async function() {
        let status = await virtualDimmer(client).getStatus();
        assert(status.components.main.switch.switch.value);
    });
});