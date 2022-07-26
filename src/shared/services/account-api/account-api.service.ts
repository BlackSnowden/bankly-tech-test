import { default as IRequestAdapter } from '@shared/adapters/request-adapter/request.protocol'
import { default as ILoggerService } from '@shared/services/logger/logger.protocol'
import { default as IMessengerService } from '@shared/services/messenger/messenger.protocol'
import { default as IDatabaseService } from '@shared/services/database/database.protocol'
import { TransactionsRepository, OperationsRepository } from '@infra/repositories'
import {
  default as IAccountApi,
  AccountBalance,
  TransactionCreatorParam,
  UpdateBalanceParam,
} from './account-api.protocol'
import { buildAccountBalancePayload, buildAccountsPayload } from './account-api.helper'
import { ExceptionHelper } from '@shared/helpers'
import { httpStatusCodes } from '@shared/adapters'
import { Transactions } from '@domain/useCases'
import { default as config } from '@config'

export default class AccountApiService implements IAccountApi {
  private serviceHost: string

  constructor(
    private requestAdapter: IRequestAdapter,
    private messengerService: IMessengerService,
    private databaseService: IDatabaseService,
    private loggerService: ILoggerService,
  ) {
    const serviceHost = config.get('bankly_host')
    if (!serviceHost) {
      throw new Error('No bankly service hostconfigured')
    }

    this.serviceHost = `${serviceHost}`
  }

  async getAccounts() {
    const response = await this.requestAdapter.get(`${this.serviceHost}/api/Account`)
    if (response.status >= 300) {
      const { traceId, message } = this.loggerService.log('ERROR', `Error to get accounts`, response.data)

      throw new ExceptionHelper(message, {
        statusCode: response.status,
        traceId,
      })
    }

    const buildedPayload = buildAccountsPayload(response.data)
    return buildedPayload
  }

  async getBalance(accountNumber: string) {
    const response = await this.requestAdapter.get(`${this.serviceHost}/api/Account/${accountNumber}`)
    if (response.status >= 300) {
      const { traceId, message } = this.loggerService.log(
        'ERROR',
        `Error to get balance from account N. ${accountNumber}`,
        response.data,
      )

      throw new ExceptionHelper(message, {
        statusCode: response.status,
        traceId,
      })
    }

    const buildedPayload = buildAccountBalancePayload(response.data)
    return buildedPayload
  }

  async updateBalance(params: UpdateBalanceParam): Promise<AccountBalance> {
    const response = await this.requestAdapter.post(`${this.serviceHost}/api/Account`, params)

    if (response.status >= 300) {
      const errorMessage = `Error to update balance to the account n. ${params.accountNumber}`
      const { traceId } = this.loggerService.log('ERROR', errorMessage, response.data)

      throw new ExceptionHelper(errorMessage, {
        statusCode: response.status,
        traceId,
      })
    }

    return this.getBalance(params.accountNumber)
  }

  async createTransaction(params: TransactionCreatorParam) {
    const { accountOrigin, accountDestination } = params

    if (accountOrigin === accountDestination) {
      const { traceId, message } = this.loggerService.log(
        'REJECTED',
        'An operation cannot be carried out between the same account',
        params,
      )

      throw new ExceptionHelper(message, {
        statusCode: httpStatusCodes.CONFLICT,
        traceId,
      })
    }

    const transactionsRepository = new TransactionsRepository(this.databaseService.instance)
    const operationsRepository = new OperationsRepository(this.databaseService.instance)

    const createdTransaction = await transactionsRepository.createTransaction({
      value: params.value,
      status: 'In Queue',
    })

    this.loggerService.log('SUCCESS', `Transaction N. ${createdTransaction.id} has been created`, createdTransaction)

    await Promise.all([
      operationsRepository.createOperation({
        transactionId: createdTransaction.id,
        accountNumber: accountOrigin,
        status: 'Pending',
        type: 'Debit',
      }),
      operationsRepository.createOperation({
        transactionId: createdTransaction.id,
        accountNumber: accountDestination,
        status: 'Pending',
        type: 'Credit',
      }),
    ])
      .then((operations) => {
        operations.forEach((operation) =>
          this.loggerService.log('SUCCESS', `Operation N. ${operation.id} has been created`, operation),
        )
      })
      .catch((error) => {
        this.loggerService.log(
          'ERROR',
          `Error creating operation referring to transaction N. ${createdTransaction.id}`,
          error,
        )
      })

    const payload = { transactionId: createdTransaction.id }

    await this.messengerService.publish(Transactions.updateStatusQueue, JSON.stringify(payload))

    return payload
  }

  async getTransactionStatus(transactionId: string) {
    const operationsRepository = new TransactionsRepository(this.databaseService.instance)
    const transaction = await operationsRepository.getTransactionById(transactionId)

    if (!transaction) {
      const { traceId, message } = this.loggerService.log('ERROR', `No transaction found with id ${transactionId}`, {
        transactionId,
      })

      throw new ExceptionHelper(message, {
        statusCode: httpStatusCodes.NOT_FOUND,
        traceId,
      })
    }

    return {
      status: transaction.status,
      error: transaction.error,
    }
  }
}
