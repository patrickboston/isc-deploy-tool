# IdentityNow Object Migration Tool
The IdentityNow Object Migration tool is a NodeJS command-line utility that allows you to export configuration objects such as Sources, Transforms, Rules, and more out of one IdentityNow environment and import/deploy them to other IdentityNow environments. It utulizes the SP-Config API endpoints to perform all export and import operations. One of the main benefits from using this tool is the ability to maintain a single configuration object that can be deploy to any environemnt via tokenization. This allows Source Code Management to actually make sense and this process could easily be plugged into a CI/CD pipeline.

It offers the following features:
- Export objects as-is (raw) out of an environment
- Export objects and perform reverse-tokenization via JSONPath which replaces actual setting values with a token in the format of %%TOKEN_NAME%%. This allows a single object to be maintained in a code repository which can be "built" for any IdentityNow environment
- Tokenize and deploy objects to a target IdentityNow environment which is the process of replacing the repository tokens with actual setting values which are needed for a specific environment (i.e. IQService host)

## Setup
This a NodeJS project that was written on NodeJS 18. You will need NodeJS install prior to using this tool

You will also need to set up the follow files in the root of your project to be able to export/import from IdentityNow environments:
- `<env>.env.js` - Holds the parameters needed to login to hit IDN API endpoints via a PAT (Personal Access Token). There is an example in this repository, but it needs to look like this:
```js
export default
    {
        baseurl: "https://<env>.api.identitynow-demo.com",
        clientId: "id1234",
        clientSecret: "secret1234",
        tokenUrl: "https://<env>.api.identitynow-demo.com/oauth/token",
    }
```
- `<env>.target.js` - Contains entries where the key is the token in your config files and the value is the specific value for that token that you want to be deployed to a target IdentityNow environment when running the `build` command
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```
- `reverse.target.js` - Contains entries specific for each config file that you would want to perform reverse-tokenization on when running the `export` command. Each entry under config file contains a key for the JSONPath of where to replace the value with the token specified
```js
export default
    {
        "SOURCE/Active Directory.json": {
            "$.object.owner.id": "%%AD_OWNER_ID%%",
            "$.object.connectorAttributes.IQServicePort": "%%AD_IQSERVICE_PORT%%",
        }
    }
```

## Commands
Once you have all the pre-reqs above setup, you can now start running some commands. Open up your favorite terminal and navigate to your project location. Our `src/index.js` file is the main file that is run with NodejS. We run the app with the following if we wanted
```
node src/index.js --export --detokenize
```
However, in the `package.json`, there are a number of scripts set up which make the commanda slightly easier to run

### Export
To export objects from a specific environment and perform reverse-tokenization based on properties defined in your `reverse.target.js` file, run the following where `<env>` is the actual name of your environemnt such as `sb`
```
npm run export:win -src-env=<env>
```

### Deploy/Import
To perform tokenization and deploy/import into a specific environemnt based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environemnt such as `sb`
```
npm run deploy:win -target-env=<env>
```

## Known Issues
- SP-Config APIs allow exports of objects which are not able to be imported