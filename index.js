const { ethers } = require('ethers')
const { Requester, Validator } = require('@chainlink/external-adapter')

const AbiCoder = ethers.utils.AbiCoder
const ADDRESS_PREFIX_REGEX = /^(41)/
const ADDRESS_PREFIX = '41'

function encodeParams (inputs) {
  let parameters = ''

  if (inputs.length === 0) return parameters
  const abiCoder = new AbiCoder()
  const types = []
  const values = []

  for (let i = 0; i < inputs.length; i++) {
    let { type, value } = inputs[i]
    if (type === 'address') value = value.replace(ADDRESS_PREFIX_REGEX, '0x')
    else if (type === 'address[]') value = value.map(v => v.toString('hex').replace(ADDRESS_PREFIX_REGEX, '0x'))
    types.push(type)
    values.push(value)
  }

  try {
    parameters = abiCoder.encode(types, values).replace(/^(0x)/, '')
  } catch (ex) {
    console.log(ex)
  }
  return parameters
}

function decodeParams (types, output, ignoreMethodHash) {
  if (!output || typeof output === 'boolean') {
    ignoreMethodHash = output
    output = types
  }

  if (ignoreMethodHash && output.replace(/^0x/, '').length % 64 === 8) {
    output = '0x' + output.replace(/^0x/, '').substring(8)
  }

  const abiCoder = new AbiCoder()

  if (output.replace(/^0x/, '').length % 64) {
    throw new Error('The encoded string is not valid. Its length must be a multiple of 64.')
  }
  return abiCoder.decode(types, output).reduce((obj, arg, index) => {
    if (types[index] === 'address') arg = ADDRESS_PREFIX + arg.substr(2).toLowerCase()
    obj.push(arg)
    return obj
  }, [])
}

// Define custom error scenarios for the API.
// Return true for the adapter to retry.
const customError = (data) => {
  if (data.Response === 'Error') return true
  return false
}

const createRequest = (input, callback) => {
  // The Validator helps you validate the Chainlink request data
  const validator = new Validator(callback, input)
  const jobRunID = validator.validated.id
  const url = 'https://api.shasta.trongrid.io/wallet/triggerconstantcontract'

  const address = (new Buffer(input.data.user, 'base64')).toString()
  const parameter = encodeParams([{ type: 'address', value: address }])

  const data = {
    owner_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    contract_address: 'TBSo1pthwZJkkXLwfNUC3wzKG2K7wt2Zvg',
    function_selector: 'confirmedTokensForUser(address)',
    parameter,
    visible: true
  }

  // This is where you would add method and headers
  // you can add method like GET or POST and add it to the config
  // The default is GET requests
  // method = 'get'
  // headers = 'headers.....'
  const config = {
    method: 'post',
    url,
    data
  }

  // The Requester allows API calls be retry in case of timeout
  // or connection failure
  Requester.request(config, customError)
    .then(response => {
      // It's common practice to store the desired value at the top-level
      // result key. This allows different adapters to be compatible with
      // one another.
      response.data.result = decodeParams(['uint256'], '0x' + Requester.getResult(response.data, ['constant_result', '0']), false)[0].toString()
      callback(response.status, Requester.success(jobRunID, response))
    })
    .catch(error => {
      callback(500, Requester.errored(jobRunID, error))
    })
}

// This is a wrapper to allow the function to work with
// GCP Functions
exports.gcpservice = (req, res) => {
  createRequest(req.body, (statusCode, data) => {
    res.status(statusCode).send(data)
  })
}

// This is a wrapper to allow the function to work with
// AWS Lambda
exports.handler = (event, context, callback) => {
  createRequest(event, (statusCode, data) => {
    callback(null, data)
  })
}

// This is a wrapper to allow the function to work with
// newer AWS Lambda implementations
exports.handlerv2 = (event, context, callback) => {
  createRequest(JSON.parse(event.body), (statusCode, data) => {
    callback(null, {
      statusCode: statusCode,
      body: JSON.stringify(data),
      isBase64Encoded: false
    })
  })
}

// This allows the function to be exported for testing
// or for running in express
module.exports.createRequest = createRequest
