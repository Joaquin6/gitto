const coreService = {
  url(business_account) {
    const protocol = business_account.match(/^http(s?):\/\//) ?
      business_account.split('://')[0] :
      'https';

    const url = business_account.match(/^http(s?):\/\//) ?
      business_account.split('://')[1] :
      business_account;

    let subdomain = 'core';
    if (!url.startsWith('local')) {
      subdomain += '-service';
    }

    return `${protocol}://${subdomain}.${url}/v1`;
  },
};

export default coreService;
