from db import fact_checks_col  
docs = list(fact_checks_col().find().sort('created_at', -1).limit(3))  
for d in docs: print(d['article_text'], len(d['claims']))  
