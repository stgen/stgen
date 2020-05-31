import { BearerTokenAuthenticator, SmartThingsClient } from '@smartthings/core-sdk';
import assert from 'assert';
import { exec } from 'child_process';
import fs from 'fs';
import rimraf from 'rimraf';
import * as generator from '../../codegen/generator';

describe('Codegen', function () {
  this.timeout(10000);
  function cleanupFiles() {
    if (fs.existsSync('test-gen')) {
      rimraf.sync('test-gen');
    }
    if (fs.existsSync('build/test-gen')) {
      rimraf.sync('build/test-gen');
    }
  }

  // Fetch the test data from the SmartThings API
  let testData: generator.SmartThingsData;
  before(async function () {
    cleanupFiles();
    testData = await generator.getAllSmartThingsData(
      new SmartThingsClient(
        new BearerTokenAuthenticator(fs.readFileSync('accessToken', 'utf-8'))));
  });

  it('should generate valid code', function (done) {
    let code = generator.generate(testData);
    fs.mkdirSync('test-gen');
    code.forEach(f => fs.writeFileSync(`test-gen/${f.fileName}`, f.source));
    exec('npm run tsc', (error, stdout, sterr) => {
      code.forEach(f =>
        assert(fs.existsSync(`build/test-gen/${f.fileName.replace('.ts', '.js')}`)));

      done(error);
    });
  });

  afterEach(function () {
    cleanupFiles();
  });
});
