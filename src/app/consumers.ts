import { default as IDatabaseService } from '@shared/services/database/database.protocol'
import { default as IMessengerService } from '@shared/services/messenger/messenger.protocol'
import { default as ILoggerService } from '@shared/services/logger/logger.protocol'
import { default as IAccountApiService } from '@shared/services/account-api/account-api.protocol'

import { Transactions, Operations } from '@domain/useCases'

export default class Consumers {
  constructor(
    private databaseService: IDatabaseService,
    private messengerService: IMessengerService,
    private logggerService: ILoggerService,
    private accountApiService: IAccountApiService,
  ) {}

  start() {
    const transactions = new Transactions(this.databaseService, this.messengerService, this.logggerService)
    const operations = new Operations(
      this.databaseService,
      this.messengerService,
      this.logggerService,
      this.accountApiService,
    )

    this.messengerService.consume(Transactions.transferQueueName, (message, done) =>
      transactions.transfer(message, done),
    )
    this.messengerService.consume(Operations.updateBalanceQueueName, (message, done) =>
      operations.updateBalance(message, done),
    )
    this.messengerService.consume(Operations.refundBalanceQueueName, (message, done) =>
      operations.refundBalance(message, done),
    )
  }
}
