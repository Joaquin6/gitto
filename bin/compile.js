const Promise = require('bluebird');
const { exec } = require('pkg');

const cliCommands = [
  'gitto_cloud_upload',
  'gitto_cloud_download',
  'gitto_cloud_create_access_token_file',
];

function generateArgs(command, platform) {
  if (platform) {
    return [
      `bin/${command}`,
      '--targets',
      `node6-${platform}-x64`,
      '-o',
      `out/${platform}/${command}`,
    ];
  }
  return [
    `bin/${command}`,
    '--targets',
    'node6',
    '-o',
    `out/${command}`,
  ];
}

(async () => {
  try {
    if (process.argv[2] === '--all') {
      await Promise.mapSeries(cliCommands, ((command) => exec(generateArgs(command, 'linux'))));
      await Promise.mapSeries(cliCommands, ((command) => exec(generateArgs(command, 'win'))));
    } else {
      await Promise.mapSeries(cliCommands, ((command) => exec(generateArgs(command))));
    }
    console.log('Compile Complete');
    process.exit();
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
})();
