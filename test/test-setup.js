import 'babel-polyfill';
import moment from 'moment';
import { Map, List, OrderedMap } from 'immutable';
import { isArray, isObject, entries, isFunction, uniqueId } from 'lodash';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

chai.use(sinonChai);
chai.use(chaiAsPromised);

const { expect } = chai;

global.sinon = sinon;
global.expect = expect;

global.TMP_FOLDER = './data/tmp_test';
global.createRandomString = uniqueId;
global.createRandomDate = () => moment(
  new Date(+(new Date()) - Math.floor(Math.random() * 10000000000)),
).toISOString();
global.createRandomISO = () => moment(global.createRandomDate()).toISOString();

function randomizer(input, key) {
  if (isFunction(input)) {
    return input(key);
  } if (Map.isMap(input) || OrderedMap.isOrderedMap(input)) {
    return input.keySeq().reduce((map, k) =>
      map.update(k, (v) => randomizer(v, k)), input);
  } else if (List.isList(input) || isArray(input)) {
    return input.map((v) => randomizer(v, key));
  } else if (isObject(input)) {
    return entries(input).reduce((obj, [k, v]) => ({
      ...obj,
      [k]: randomizer(v, k),
    }), {});
  }

  return input;
}

global.createRandom = (creator) => randomizer(creator({
  string: global.createRandomString,
  number: () => Math.random(),
  date: global.createRandomDate,
  ISO: global.createRandomISO,
  bool: () => Math.random() >= 0.5,
}));
