function resultForUser({ status, ownScore, opponentScore }) {
  if (status !== 'completed') return 'VOID';

  if (ownScore === null || ownScore === undefined || ownScore === '' || opponentScore === null || opponentScore === undefined || opponentScore === '') return 'VOID';
  const own = Number(ownScore);
  const opponent = Number(opponentScore);
  if (!Number.isFinite(own) || !Number.isFinite(opponent)) return 'VOID';
  if (own > opponent) return 'WIN';
  if (own < opponent) return 'LOSS';
  return 'DRAW';
}

module.exports = { resultForUser };
