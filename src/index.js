const cacheInstance = require("./cache");
const { getBlame, listFiles } = require("./git");
const Queue = require("./queue");

function appendBlame(data, moreData) {
  Object.keys(moreData).forEach(dateKey => {
    if (!data.hasOwnProperty(dateKey)) {
      data[dateKey] = moreData[dateKey];
      return;
    }

    Object.keys(moreData[dateKey]).forEach(authorKey => {
      if (!data[dateKey].hasOwnProperty(authorKey)) {
        data[dateKey][authorKey] = moreData[dateKey][authorKey];
        return;
      }

      data[dateKey][authorKey] += moreData[dateKey][authorKey];
    });
  });
}

function getLevelBefore(contributorByName, active, who) {
  // Find if there was an override
  if (
    contributorByName.hasOwnProperty(who) &&
    contributorByName[who].hasOwnProperty("active")
  ) {
    return contributorByName[who].active ? "passive" : "lost";
  }

  return active.hasOwnProperty(who) ? "passive" : "lost";
}

function getLevelAfter(contributorByName, who) {
  // Find if there was an override
  if (
    contributorByName.hasOwnProperty(who) &&
    contributorByName[who].hasOwnProperty("active")
  ) {
    return contributorByName[who].active ? "active" : "lost";
  }

  return "active";
}

function computeAbsorption(threshold, contributors, data, verbose) {
  // First we categorize in before / after the threshold
  const before = {};
  const after = {};

  const contributorByName = contributors.reduce((acc, curr) => {
    acc[curr.name] = curr;
    return acc;
  }, {});

  Object.keys(data).forEach(key => {
    const storeInto = parseInt(key, 10) < threshold ? before : after;

    Object.keys(data[key]).forEach(who => {
      let name = who;
      const contributor = contributors.find(
        c => c.identities.indexOf(who) > -1
      );
      if (contributor) {
        // Ignore bots from data
        if (contributor.type === "bot") {
          return;
        }
        name = contributor.name;
      }

      if (!storeInto.hasOwnProperty(name)) {
        storeInto[name] = 0;
      }

      storeInto[name] += data[key][who];
    });
  });

  // Then, we categorize in active, passive and lost
  // Active is the amount of lines written in the last year by people still active
  // Passive is the amount of lines written before last year by people still active
  // Lost is the amount of lines written before last year by people inactive
  const levels = {
    active: { total: 0 },
    passive: { total: 0 },
    lost: { total: 0 }
  };

  // Code that was contributed more recently than the threshold is considered active
  // Except if the contributor has been explicitly set as "active: false"
  // In that case, it's considered lost
  Object.keys(after).forEach(who => {
    const level = getLevelAfter(contributorByName, who);
    levels[level][who] = after[who];
    levels[level].total += after[who];
  });

  // Code that was contributed before the thresold is considered lost
  // If it was contributed by an active commiter, it is considered passive
  // If it was contributed by a member explicitly set as "active: true"
  // it will be set as passive even if the contributor didn't contribute more recently.
  Object.keys(before).forEach(who => {
    const level = getLevelBefore(contributorByName, levels.active, who);
    if (!levels[level].hasOwnProperty(who)) {
      levels[level][who] = 0;
    }
    levels[level][who] += before[who];
    levels[level].total += before[who];
  });

  return levels;
}

function toPercentage(current, total) {
  return (current * 100) / total;
}

function sortByKnowledge(elements) {
  elements.sort((a, b) => {
    if (a.lines < b.lines) {
      return 1;
    } else if (a.lines > b.lines) {
      return -1;
    } else {
      return 0;
    }
  });

  return elements;
}

function combineActiveAndPassive(active, passive) {
  const combined = {};
  Object.keys(active).forEach(who => {
    if (who === "total") {
      return;
    }
    combined[who] = {
      name: who,
      lines: active[who],
      activeLines: active[who],
      passiveLines: 0
    };
  });

  Object.keys(passive).forEach(who => {
    if (who === "total") {
      return;
    }
    if (!combined.hasOwnProperty(who)) {
      combined[who] = {
        name: who,
        lines: 0,
        activeLines: 0,
        passiveLines: 0
      };
    }
    combined[who].lines += passive[who];
    combined[who].passiveLines = passive[who];
  });

  return combined;
}

function rebalance(newData, weight) {
  const final = {};
  Object.keys(newData).forEach(timestamp => {
    final[timestamp] = {};

    Object.keys(newData[timestamp]).forEach(who => {
      final[timestamp][who] = newData[timestamp][who] * weight;
    });
  });

  return final;
}

module.exports = async function main(
  contributors,
  getWeight,
  threshold,
  repository,
  verbose
) {
  const queue = new Queue(verbose);
  const data = {};
  const fileData = {};

  await listFiles(repository, (filename, hash) => {
    const weight = getWeight(filename);

    if (weight === 0) {
      if (verbose) {
        console.log("Ignoring file", filename);
      }

      return;
    }

    const cacheKey = `${repository}:${hash}:${filename}:v2`;
    queue.add({
      name: filename,
      fn: async () => {
        const newData = await cacheInstance.wrap(cacheKey, () =>
          getBlame(repository, filename)
        );

        if (verbose) {
          fileData[filename] = newData;
        }

        const balanced = rebalance(newData, weight);

        appendBlame(data, balanced);
      }
    });
  });

  await queue.await();

  const { active, passive, lost } = computeAbsorption(
    threshold,
    contributors,
    data,
    verbose
  );

  const totalLines = active.total + passive.total + lost.total;
  const activePercentage = Math.round(toPercentage(active.total, totalLines));
  const passivePercentage = Math.round(toPercentage(passive.total, totalLines));
  const lostPercentage = Math.round(toPercentage(lost.total, totalLines));

  const combined = combineActiveAndPassive(active, passive);

  const activeKnowledge = sortByKnowledge(Object.values(combined));

  const computed = {
    total: totalLines,
    categories: {
      active,
      passive,
      lost
    },
    absorption: {
      active: activePercentage,
      passive: passivePercentage,
      lost: lostPercentage
    },
    knowledge: {
      active: sortByKnowledge(activeKnowledge),
      lost: sortByKnowledge(
        Object.entries(lost)
          .filter(entry => entry[0] !== "total")
          .map(([name, lines]) => ({ name, lines }))
      )
    }
  };

  if (verbose) {
    computed.fileData = fileData;
  }

  return computed;
};
