#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const colors = require('colors');
const prompt = require('prompt');
const promptAuto = require('prompt-autocomplete');
const homedir = require('homedir')();
const argv = require('minimist')(process.argv.slice(2));
const dictionaryPath = argv.open || argv.o || path.join(homedir, '.words.json');
const persistenceFile = path.resolve(process.cwd(), dictionaryPath);
const coverageParam = argv.coverage || argv.c || -1;
const mute = argv.mute || argv.m;
const experimentCount = argv.experiment || argv.e || 100;


try { fs.accessSync(persistenceFile, fs.F_OK); }
catch (err) {
    if (err.code != 'ENOENT') return console.log(err);
    fs.writeFileSync(persistenceFile, JSON.stringify({}, null, 4));
}

const words = require(persistenceFile);

process.on('uncaughtException', gracefulExit);
process.on('SIGTERM', gracefulExit);
process.on('SIGINT', gracefulExit);


const defaultWeek = _.chain(words)
    .keys()
    .map(weekName => parseInt(weekName.slice(4), 10))
    .sortBy()
    .reverse()
    .head()
    .value();

const prepWeek = parseInt(argv.w || argv.week || defaultWeek || 1, 10);
const wordList = _.merge(... _.cloneDeep(_.valuesIn(_.pickBy(words, (_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek))));
const checklist = _.chain(words)
    .pickBy((_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek)
    .flatMap(week => Object.keys(week))
    .keyBy()
    .mapValues(_ => false)
    .value();

const focus = argv.focus || argv.f || prepWeek;
const desiredCoverage = coverageParam <= 0 ? 100 :
                        coverageParam < 1 ? 100 * coverageParam :
                        100 * coverageParam / _.size(checklist);

const depth = argv.depth || argv.d || ((desiredCoverage / 100 > 0.5) ? desiredCoverage / 100 : 0.7);

console.log('Welcome to GRE - Tutor '.black + ' v' + require('./package.json').version);
console.log('It appears we are working on ' + 'week '.red + prepWeek.toString().red);


if (argv.version) return;
if (argv.load) return restoreSave('./words.json');
if (argv.help || argv.h) return showHelp();
if (argv.add || argv.a) return addWords();
if (argv.backup || argv.b) return save(path.resolve(argv.backup || argv.b));
if (argv.restore || argv.r) return restoreSave(path.resolve(argv.restore || argv.r));
if (argv.train || argv.t) return train().catch(err => err).then(err => {
    pronounce('Congratulations, you have trained on ' + _.filter(checklist).length.toString() + ' different words');
    analyzeTrainingAndPrint();
    if (err) gracefulExit(err);
});
if (argv.test) return test();
if (argv.search || argv.s) return search();
return console.log(words, `\nThere are ${_.keys(checklist).length} words in dictionary.`);


/**
 * TEST LOGIC
 */

function test() {
    console.log(`
/***** SIMULATING ${experimentCount} TRAININGS *****/
`.gray);

    const experimentResults = _.chain(words)
        .pickBy((_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek)
        .mapValues(_ => 0)
        .value();


    for (let i = 0; i < experimentCount; i++) {
        const selected = {};
        const experimentalCheckList = _.cloneDeep(checklist);

        while(coverage({list: experimentalCheckList}) < desiredCoverage) {
            const {word, meaning} = getRandomWord({list: experimentalCheckList});
            const week = parseInt(_.findKey(words, week => _.keys(week).includes(word)).slice(4), 10);
            if (!selected[`week${week}`]) selected[`week${week}`] = 0;

            experimentalCheckList[word] = true;
            selected[`week${week}`]++;
        }

        _.mergeWith(experimentResults, selected, _.add);
    }


    console.log(experimentCount.toString().green + ' demo trainings with %'.black +
                desiredCoverage.toString().blue + ' coverage '.black +
                'on week '.black + prepWeek.toString().red + ' resulted with,'.black);

    console.log(Math.ceil(_.keys(wordList).length * desiredCoverage / 100).toString().red +
                ' of '.grey +
                _.keys(wordList).length.toString().blue + ' words are asked on each training. Out of those:'.grey);


    const total = _.reduce(experimentResults, _.add);
    const percentages = _.mapValues(experimentResults, (val, week) => '' +
        Math.round(val / experimentCount) + ' of ' + _.size(words[week]) + ' ' +
        'words are asked (%' + (100 * val / experimentCount / _.size(words[week])).toFixed(1) + ') ' +
        '---> %' + (100 * val / total).toFixed(1)
    );

    console.log(percentages);
}


/**
 * INSERTION LOGIC
 */

function addWords() {
    const insertWordLoop = _ => insertWord().then(_ => insertWordLoop());
    return insertWordLoop().catch(gracefulExit);
}


function insertWord() {
    let speechFinished;

    return new Promise((resolve, reject) => {
        if (!words[`week${prepWeek}`]) words[`week${prepWeek}`] = {};

        const wordCount = Object.keys(words[`week${prepWeek}`]).length;
        const wordVar = `word #${wordCount + 1} of week${prepWeek}`;

        prompt.get(wordVar, (err, response) => {
            if (err) return reject(err);
            const word = response[wordVar];

            speechFinished = pronounce(word);

            prompt.get('meaning', (err, response) => {
                if (err) return reject(err);

                words[`week${prepWeek}`][word] = response.meaning;
                resolve();
            });
        });
    })
    .then(_ => speechFinished);
}


/**
 * TRAINING LOGIC
 */


function train() {
    const askLoop = _ => askAWord().then(_ => coverage() >= desiredCoverage ? Promise.resolve : askLoop());
    return askLoop();
}


function coverage({inclusive = 0, list = checklist} = {}) {
    return 100 * (_.filter(list).length + inclusive) / _.keys(list).length;
}

function askAWord() {
    let speechFinished;

    return new Promise((resolve, reject) => {
        const {word, meaning} = getRandomWord();
        speechFinished = pronounce(word);

        const covered = coverage({inclusive: 1});
        const wordQuestion = `${word.blue} %${Math.floor(100 * covered / desiredCoverage)}`;


        const correctAnswer = function() {
            checklist[word] = true;
            console.log('Perfect!'.green);
            resolve();
        };

        const wrongAnswer = function() {
            console.log('OK, we\'ll come back to this one later...'.grey);
            resolve();
        };

        prompt.get(wordQuestion, (err, response) => {
            if (err) return reject(err);
            console.log(`${word.cyan} means `.black + meaning.red);

            if (response[wordQuestion].toLowerCase() == 'y' ||
                response[wordQuestion].toLowerCase() == 'yes')
                return correctAnswer();

            if (response[wordQuestion] == '') {
                const question = 'Did you know it?'.magenta;

                prompt.get(question, (err, response) => {
                    if (err) return reject(err);

                    if (response[question] == '' ||
                        response[question].toLowerCase() == 'y' ||
                        response[question].toLowerCase() == 'yes')
                        return correctAnswer();
                    else return wrongAnswer();

                });
            } else return wrongAnswer();
        });
    })
    .then(_ => speechFinished);
}


function getRandomWord({list = checklist} = {}) {
    const word = _.chain(wordList)
        .keys()
        .filter(word => !list[word])
        .sample()
        .value();

    const meaning = wordList[word];

    const weekOfTheWord = parseInt(_.findKey(words, week => _.keys(week).includes(word)).slice(4), 10);
    const gaussian = gaussianGenerator(1, focus, (prepWeek * depth - 1) || 0.01);
    const p_selectingWeek = gaussian(weekOfTheWord);

    if (Math.random() < p_selectingWeek) return {word, meaning};
    return getRandomWord({list});
}


function gaussianGenerator(peakValue, peakPosition, peakWidth) {
    return function(x) {
        const deviation = ((x - peakPosition) * (x - peakPosition)) / (2 * peakWidth * peakWidth);
        return peakValue * Math.exp(-1 * deviation);
    }
}


function analyzeTrainingAndPrint() {
    const trained = _.chain(words)
        .pickBy((_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek)
        .mapValues(_ => 0)
        .value();

    const trainedWords = _.chain(checklist)
        .pickBy(_.identity)
        .keys()
        .value();

    _.forEach(words, (week, weekName) => _.keys(week).forEach(word => {
        if (trainedWords.includes(word))
            trained[weekName]++;
    }));

    console.log('');
    console.log('The training analyis with %'.black +
                desiredCoverage.toString().blue + ' coverage '.black +
                'on week '.black + prepWeek.toString().red + ':'.black);

    console.log('You have trained on ' + _.filter(checklist).length.toString().red + ' ' +
                'of ' + _.size(checklist).toString().blue + ' words in dictionary');


    const total = _.reduce(trained, _.add);
    const percentages = _.mapValues(trained, (val, week) => '' +
        val + ' of ' + _.size(words[week]) + ' ' +
        'words are asked (%' + (100 * val / _.size(words[week])).toFixed(1) + ') ' +
        '---> %' + (100 * val / total).toFixed(1)
    );

    console.log(percentages);
}

/**
 * SEARCH LOGIC
 */

function search() {
    const searchLoop = _ => searchAWord().then(_ => searchLoop());
    return searchLoop().catch(gracefulExit);
}


function searchAWord() {
    const searchList = _.assign({}, wordList, _.invert(wordList));

    return new Promise((resolve, reject) => {
        promptAuto('Word:', Object.keys(searchList), (err, word) => {
            if (err) return reject(err);
            console.log(word.blue + ' => '.black + searchList[word].red);

            const searchIsEnglish = _.has(wordList, word);

            if (searchIsEnglish) resolve(word);
            else resolve(searchList[word]);
        });
    })
    .then(pronounce)
    .then(_ => {
        return new Promise((resolve, reject) => {
            const listener = _ => {
                process.stdin.removeListener('data', listener);
                resolve();
            };

            process.stdin.resume();
            process.stdin.on('data', listener);
        });
    });
}


/**
 * PERSISTENCE LOGIC
 */

function save(path = persistenceFile) {
    fs.writeFileSync(path, JSON.stringify(words, null, 4));
    console.log('All changes are saved to '.green + path.black);
}


function gracefulExit(e) {
    if (e && e.message !='canceled') console.log(e || e.stack || e.message);
    save();
    process.exit();
}


/**
 * RESTORE LOGIC
 */

function restoreSave(path) {
    if (!_.isString(path)) return console.log('You must type a valid backup file path');

    const restoredWords = require(path);
    fs.writeFileSync(persistenceFile, JSON.stringify(restoredWords, null, 4));

    console.log('Dictionary is replaced with the file at '.green + path.black);
    process.exit();
}


function pronounce(word, voice = argv.v || argv.voice || 'Samantha') {
    if (mute) return Promise.resolve();
    if (process.platform !== 'darwin') return Promise.resolve();

    return new Promise((resolve, reject) => {
        require('child_process').exec(`say ${word} -v ${voice}`, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}


/**
 * HELP
 */

function showHelp() {
    console.log(`
/*****************************************************
GRE - Vocabulary Tutor
Version: ${require('./package.json').version.grey}
*****************************************************/

How to Train?

- Start the tutor with '-t' option
- Tutor will ask a word
- If you know the meaning of the word, type 'y' or 'yes' and press 'Enter' to get the next challenge
- If you are not 100% sure, just press 'Enter'
- The tutor will reveal the meaning. If it is the same as you think it was, press 'Enter' again
- If you type anything other at the first or second step, the meaning will be shown but the word will be asked later again
- Repeat until desired coverage (%) is reached


Usage:

* ${'gre-tutor [--open | -o <filepath>]'.blue} : Lists all the words in the opened dictionary
* ${'gre-tutor (--help | -h)'.blue} : Show this help page
* ${'gre-tutor --load'.blue} : Load the initial dictionary available with this program
* ${'gre-tutor (--add | -a) [--week | -w <weeknumber>] [--voice | -v <voicename>] [--mute | -m] [--open | -o <filepath>]'.blue} : Insert words to the dictionary
* ${'gre-tutor (--train | -t) [--week | -w <weeknumber>] [--voice | -v <voicename>] [--mute | -m] [--coverage | -c <percentage>] [--open | -o <filepath>]'.blue} : Train on the words in the dictionary
* ${'gre-tutor (--search | -s) [--voice | -v <voicename>] [--mute | -m] [--open | -o <filepath>]'.blue} : Search words in the dictionary
* ${'gre-tutor (--backup | -b) <filepath> [--open | -o <filepath>]'.blue} : Create a copy of the currently open dictionary at the desired filepath
* ${'gre-tutor (--restore | -r) <filepath>'.blue} : Overwrite the default dictionary with the dictionary at the filepath
* ${'gre-tutor --test [--week | -w <weeknumber>] [--coverage | -c <percentage>] [--experiment | -e <number>] [--open | -o <filepath>]'.blue} : Simulate trainings and see how many words from each week will be asked approximately.


Notes:

${'--open | -o <filepath>'.cyan} : Default is '~/.words.json'. This parameter changes the load/save path of the dictionary only for this run.
${'--week | -w <number>'.cyan} : Default is the last week. This parameter serves 2 purposes
    1. When inserting words, it inserts into the appropriate week
    2. When training words, it adjusts the probability of a word coming up, depending on its week
${'--voice | -v <voiceName>'.cyan} : Default is Samantha. Change the voice of the pronounciation. For the list of available voices, you may type 'say -v ?' in your terminal or may refer to apple docs.
${'--mute | -m'.cyan} : Type this option if hearing the pronunciation annoys you.
${'--coverage | -c <number>'.cyan} : Default is %100, meaning all words will be asked. You may set a desired coverage amount for training, either by percentage with a value [0, 1], or by the exact number of words to be asked [1, ∞).
${'--experiment | -e <number>'.cyan} : Default is 100. Set the desired number of simulations while testing


Examples:

${'$ gre-tutor'.magenta} -> List all words in default dictionary
${'$ gre-tutor --load'.magenta} -> Load words packaged with this program as your dictionary
${'$ gre-tutor --open myDict.json --add'.magenta} -> Add words to the last week of dictionary at myDict.json
${'$ gre-tutor -a -w 3'.magenta} -> Add words to the 3rd week of the default dictionary
${'$ gre-tutor -t -v Alex -c 75'.magenta} -> Train on the default dictionary with 75% coverage. Use Alex voice as pronunciation
${'$ gre-tutor --search -m -o myDict.json'.magenta} -> Browse words in myDict.json dictionary and mute the voice while browsing
${'$ gre-tutor --backup backup.json --open myDict.json'.magenta} -> Create a backup of myDict.json at backup.json
${'$ gre-tutor --restore backup.json'.magenta} -> Overwrite the default dictionary with the contents of backup.json
${'$ gre-tutor --test -c 70 -e 50'.magenta} -> Simulate 50 trainings and see the word distribution depending on your coverage. With %100 coverage, all questions gets asked.


More options on training (you can also play with test to see your working plan):
${'--focus | -f <number>'.cyan} : Default is 1. Adjusts the focused week number.
${'--depth | -d <number>'.cyan} : Default is dependent on coverage or 0.7. Set between [0, 1] where 1 means the most even distribution
`);
}
