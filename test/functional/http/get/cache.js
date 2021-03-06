/*
 * Copyright © 2018 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

'use strict';

require('../../functional.js');
const Promise = require('bluebird');
const SwaggerEndpoint = require('../../../common/swagger_spec');
const accountFixtures = require('../../../fixtures/accounts');
const modulesLoader = require('../../../common/modules_loader');
const apiHelpers = require('../../../common/helpers/api');
const waitFor = require('../../../common/utils/wait_for');

const waitForBlocksPromise = Promise.promisify(waitFor.blocks);
const onNewRoundPromise = Promise.promisify(waitFor.newRound);
const expectSwaggerParamError = apiHelpers.expectSwaggerParamError;

describe('cached endpoints', () => {
	let cache;
	let getJsonForKeyPromise;

	before(done => {
		__testContext.config.cacheEnabled = true;
		modulesLoader.initCache((err, __cache) => {
			cache = __cache;
			getJsonForKeyPromise = Promise.promisify(cache.getJsonForKey);
			expect(err).to.not.exist;
			expect(__cache).to.be.an('object');
			return done(err);
		});
	});

	afterEach(done => {
		cache.flushDb((err, status) => {
			expect(err).to.not.exist;
			expect(status).to.equal('OK');
			done(err);
		});
	});

	after(done => {
		cache.quit(done);
	});

	describe('@sequential tests', () => {
		describe('GET /transactions', () => {
			const transactionsEndpoint = new SwaggerEndpoint('GET /transactions');

			it('cache transactions by the url and parameters when response is a success', () => {
				const params = {
					senderId: accountFixtures.genesis.address,
				};

				return transactionsEndpoint.makeRequest(params, 200).then(res => {
					return Promise.all(
						[0, 10, 100].map(delay => {
							return Promise.delay(delay).then(() => {
								return getJsonForKeyPromise(res.req.path);
							});
						})
					).then(responses => {
						expect(responses).to.deep.include(res.body);
					});
				});
			});

			it('should not cache if response is not a success', () => {
				const params = {
					whateversenderId: accountFixtures.genesis.address,
				};

				return transactionsEndpoint.makeRequest(params, 400).then(res => {
					expect(res)
						.to.have.property('status')
						.to.equal(400);
					expect(res).to.have.nested.property('body.message');

					return getJsonForKeyPromise(res.req.path).then(response => {
						expect(response).to.eql(null);
					});
				});
			});
		});

		describe('GET /blocks', () => {
			const blocksEndpoint = new SwaggerEndpoint('GET /blocks');

			it('cache blocks by the url and parameters when response is a success', () => {
				const params = {
					height: '1',
				};
				let initialResponse = null;

				return blocksEndpoint
					.makeRequest(params, 200)
					.then(res => {
						initialResponse = res;
						return Promise.all(
							[0, 10, 100].map(delay => {
								return Promise.delay(delay).then(() => {
									return getJsonForKeyPromise(res.req.path);
								});
							})
						);
					})
					.then(responses => {
						expect(responses).to.deep.include(initialResponse.body);
					});
			});

			it('should not cache if response is not a success', () => {
				return blocksEndpoint
					.makeRequest({ height: -100 }, 400)
					.then(res => {
						expectSwaggerParamError(res, 'height');
						return getJsonForKeyPromise(res.req.path);
					})
					.then(response => {
						expect(response).to.eql(null);
					});
			});

			it('should remove entry from cache on new block', () => {
				const params = {
					height: 1,
				};

				let initialResponse = null;

				return blocksEndpoint
					.makeRequest(params, 200)
					.then(res => {
						initialResponse = res;
						return Promise.all(
							[0, 10, 100].map(delay => {
								return Promise.delay(delay).then(() => {
									return getJsonForKeyPromise(res.req.path);
								});
							})
						);
					})
					.then(responses => {
						expect(responses).to.deep.include(initialResponse.body);
					})
					.then(() => {
						return waitForBlocksPromise(1, null);
					})
					.then(() => {
						return getJsonForKeyPromise(initialResponse.req.path);
					})
					.then(result => {
						expect(result).to.eql(null);
					});
			});
		});

		describe('GET /delegates', () => {
			const delegatesEndpoint = new SwaggerEndpoint('GET /delegates');

			it('should cache delegates when response is successful', () => {
				return delegatesEndpoint.makeRequest({}, 200).then(res => {
					return Promise.all(
						[0, 10, 100].map(delay => {
							return Promise.delay(delay).then(() => {
								return getJsonForKeyPromise(res.req.path);
							});
						})
					).then(responses => {
						expect(responses).to.deep.include(res.body);
					});
				});
			});

			it('should not cache delegates when response is unsuccessful', () => {
				const params = {
					sort: 'invalidValue',
				};

				return delegatesEndpoint.makeRequest(params, 400).then(res => {
					return getJsonForKeyPromise(res.req.path).then(response => {
						expect(response).to.not.exist;
					});
				});
			});
		});
	});

	describe('@slow tests', () => {
		describe('GET /delegates', () => {
			const delegatesEndpoint = new SwaggerEndpoint('GET /delegates');

			it('should flush cache on the next round @slow', () => {
				const params = {
					username: 'genesis_90',
				};
				let urlPath;

				return delegatesEndpoint.makeRequest(params, 200).then(res => {
					urlPath = res.req.path;
					// Check key in cache after, 0, 10, 100 ms, and if value exists in any of this time period we respond with success
					return Promise.all(
						[0, 10, 100].map(delay => {
							return Promise.delay(delay).then(() => {
								return getJsonForKeyPromise(res.req.path);
							});
						})
					).then(responses => {
						expect(responses).to.deep.include(res.body);
						return onNewRoundPromise(null).then(() => {
							return getJsonForKeyPromise(urlPath).then(result => {
								expect(result).to.not.exist;
							});
						});
					});
				});
			});
		});
	});
});
