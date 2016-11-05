#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const colors = require('colors');
const prompt = require('prompt');
const search = require('prompt-autocomplete');
const homedir = require('homedir')();
const argv = require('minimist')(process.argv.slice(2));
const dictionaryPath = argv.open || argv.o || path.join(homedir, '.words.json');
const persistenceFile = path.resolve(process.cwd(), dictionaryPath);


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
    .sort()
    .reverse()
    .head()
    .value();

const prepWeek = parseInt(argv.w || argv.week || defaultWeek || 1, 10);
const wordList = _.merge(... _.valuesIn(words));
const checklist = _.chain(words)
    .pickBy((_, weekName) => parseInt(weekName.slice(4), 10) <= prepWeek)
    .flatMap(week => Object.keys(week))
    .keyBy()
    .mapValues(_ => false)
    .value();


if (argv.help || argv.h) return showHelp();
if (argv.add || argv.a) return addWords();
if (argv.backup || argv.b) return save(path.resolve(argv.backup || argv.b));
if (argv.restore || argv.r) return restoreSave(path.resolve(argv.restore || argv.r));
if (argv.study || argv.s) return study().then(_ => console.log('Congratulations, you studied all the ' + _.keys(checklist.length) + ' words'));
if (argv.meaning || argv.m) return translate();
return console.log(`There are ${_.keys(checklist).length} words in dictionary. They are:\n`, words);


/**
 * INSERTION LOGIC
 */

function addWords() {
    const insertWordLoop = _ => insertWord().then(_ => insertWordLoop());
    insertWordLoop().catch(gracefulExit);
}


function insertWord() {
    return new Promise((resolve, reject) => {
        if (!words[`week${prepWeek}`]) words[`week${prepWeek}`] = {};

        const wordCount = Object.keys(words[`week${prepWeek}`]).length;
        const wordVar = `word #${wordCount + 1} of week${prepWeek}`;

        prompt.get([wordVar, 'meaning'], (err, response) => {
            if (err) return reject(err);

            words[`week${prepWeek}`][response[wordVar]] = response.meaning;
            resolve();
        });
    });
}


/**
 * STUDY LOGIC
 */


function study() {
    const askLoop = () => askAWord().then(() => _.every(checklist) ? Promise.resolve : askLoop());
    askLoop().catch(gracefulExit);
}


function askAWord() {
    return new Promise((resolve, reject) => {
        const week = getRandomWeek();
        const word = getRandomWord(week);
        const meaning = week[word];

        const covered = 100 * _.filter(checklist).length / _.keys(checklist).length;
        const wordQuestion = `${word.blue} %${covered.toFixed(0)}`;

        prompt.get(wordQuestion, (err, response) => {
            if (err) return reject(err);

            if (response[wordQuestion] == meaning || response[wordQuestion] == '') {
                checklist[word] = true;
                console.log('Correct. It\'s: '.black + meaning.red);
            }
            else
                console.log('NOPE! '.black + 'It means '.grey + meaning.red);

            resolve();
        });
    });
}


function getRandomWord(week = prepWeek) {
    const randomWord = _.sample(Object.keys(week));

    if (!checklist[randomWord]) return randomWord;
    return getRandomWord(week);
}


function getRandomWeek() {
    const randomWeek = Math.floor(Math.random() * prepWeek) + 1;
    const gaussian = gaussianGenerator(1, 1, (prepWeek - 1) || 0.01);
    const p_randomWeek = gaussian(randomWeek);

    const allChecked = _.every(Object.keys(words[`week${randomWeek}`]), word => checklist[word]);

    if (!allChecked && Math.random() < p_randomWeek) return words[`week${randomWeek}`];
    return getRandomWeek();
}


function gaussianGenerator(peakValue, peakPosition, peakWidth) {
    return function(x) {
        const deviation = ((x - peakPosition) * (x - peakPosition)) / (2 * peakWidth * peakWidth);
        return peakValue * Math.exp(-1 * deviation);
    }
}

/**
 * TRANSLATE LOGIC
 */

function translate() {
    const translateLoop = _ => searchAWord().then(_ => translateLoop());
    translateLoop().catch(gracefulExit);
}


function searchAWord() {
    return new Promise((resolve, reject) => {
        search('Word:', Object.keys(wordList), (err, word) => {
            if (err) return reject(err);
            console.log(word.blue + ' => '.black + wordList[word].red);
            resolve();
        });
    })
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
};


function gracefulExit(e) {
    console.log(e.black);
    save();
    process.exit();
}


/**
 * RESTORE LOGIC
 */

function restoreSave(path) {
    if (!_.isString(path)) return console.log('You must type a valid backup file path');

    words = require(path);
    console.log('Dictionary is replaced with the file at '.green + path.black);
    gracefulExit();
}


/**
 * HELP
 */

function showHelp() {
    console.log(`
GRE - Vocabulary Tutor
Version: ${require('./package.json').version.grey}

Options:

* If you start without any options, it will list your whole dictionary
* ${'--add | -a'.blue} : Add words to dictionary manually
* ${'--study | s'.blue} : Study the dictionary
* ${'--week | -w <number>'.blue} : Start studying/adding words to the weeks deck. For example:
node index.js --add -w 3 -> Will add words to 3rd week
node index.js -s --week 5 -> Will modify the word frequency as if you just finished building the 5th deck
${'If you don\'t specify any week, it will continue from the latest week you\'ve been so far'.cyan}
* ${'--meaning | -m'.blue} : Search dictionary for the meaning of a word
* ${'--backup | -b <filepath>'.blue} : Save a copy of the dictionary at the filepath
* ${'--restore | -r <filepath>'.blue} : Replace default dictionary with the contents of a backup dictionary.
* ${'--help | -h'.blue} : Show help

To start the tutor with a dictionary file other than the default, use 'open' option as:
* ${'--open | -o <filepath>'.blue} : Start the tutor with a custom dictionary. This is optional.
`);
}
