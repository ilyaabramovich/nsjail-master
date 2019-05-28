const { readFile, writeFile, remove } = require('fs-extra')
const chokidar = require('chokidar')
const path = require('path')
const { exec } = require('child_process')
const {
  getTasksDirPath,
  getRunsDirPath,
  getSolutionsDirPath,
  STATUS
} = require('./utils')
const logger = require('./config/winston')

async function updateMeta (dir, patch) {
  const metaFile = path.join(dir, 'meta.json')
  const meta = JSON.parse(await readFile(metaFile))
  return writeFile(metaFile, JSON.stringify({ ...meta, ...patch }))
}

function processTask (dir, meta) {
  logger.info('Processing task:', meta)
  const { task, id } = meta
  let sourceDir
  let execPath
  let options
  return new Promise(async (resolve, reject) => {
    if (task === 'compile') {
      sourceDir = getSolutionsDirPath(id)
      logger.info('compiling...')
      execPath = `nsjail -v --cwd=${sourceDir} --config ${__dirname}/java.cfg -- /usr/bin/javac ${sourceDir}/Main.java`
      options = { cwd: sourceDir }
    } else if (task === 'run') {
      sourceDir = getRunsDirPath(id)
      logger.info('running...')
      execPath = `nsjail -v --cwd=${dir} --config ${__dirname}/java.cfg -- /usr/bin/java -cp ${dir} Main`
      options = { cwd: dir }
    }
    await updateMeta(sourceDir, STATUS.processing)
    const cp = exec(execPath, options, async (error, stdout, stderr) => {
      if (error) {
        logger.error(`exec error: ${error}`)
        await updateMeta(sourceDir, STATUS.error)
        await remove(dir)
        return reject(error)
      }
      if (task === 'compile') {
        await updateMeta(sourceDir, STATUS.ok)
      } else if (task === 'run') {
        logger.info(`stdout: ${stdout}`)
        logger.info(`stderr: ${stderr}`)
        const output = await readFile(path.join(dir, 'output.txt'), 'utf8')
        const checkResult = +(output.trim() === stdout.trim())
        await updateMeta(sourceDir, { checkResult, ...STATUS.ok })
      }
      await remove(dir)
      return resolve()
    })
    if (task === 'run') {
      const input = await readFile(path.join(dir, 'input.txt'), 'utf8')
      cp.stdin.write(input)
      cp.stdin.end()
    }
  })
}

async function main () {
  const watcher = chokidar.watch(getTasksDirPath(), {
    usePolling: true,
    interval: 100,
    ignoreInitial: true,
    ignored: /[/\\]\./,
    persistent: true
  })
  watcher
    .on('addDir', async (dirName) => {
      const meta = JSON.parse(await readFile(path.join(dirName, 'meta.json')))
      await processTask(dirName, meta)
    })
    .on('error', error => logger.error(`Watcher error: ${error}`))
}

main()