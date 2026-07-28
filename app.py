import sqlite3
import json
from flask import Flask, redirect, render_template, request

app = Flask(__name__)

@app.route('/', methods=['GET', 'POST'])
def index():
    
    # Connection the database
    connect = sqlite3.connect('fightClub.db', check_same_thread=False)
    c = connect.cursor()
    
    if request.method == 'GET':
        return render_template('index.html')
    else:
        username1 = request.form.get("username1")
        username2 = request.form.get("username2")
        row = c.execute("SELECT username FROM players")
        results = c.fetchall()
        
        if not username1 or not username2:
            return render_template("index.html")
        
        if username1 in str(results):
            player1 = username1
        else:
            c.execute("INSERT INTO players (username) VALUES (?)", (username1,))    
        
        if username2 in str(results):
            player2 = username2
        else:
            c.execute("INSERT INTO players (username) VALUES (?)", (username2,))  
    
    # Close the database connection
    connect.commit()
    connect.close()               
    return render_template("arcadeFight.html", player_one_html=username1, player_two_html=username2)

@app.route('/rank', methods=['GET', 'POST'])
def rank():    
    if request.method == 'POST':
        return render_template('index.html')
    else:
         # Connection the database
        connect = sqlite3.connect('fightClub.db', check_same_thread=False)
        connect.row_factory = sqlite3.Row
        c = connect.cursor()
        c.execute("SELECT * FROM players ORDER BY win DESC, lose ASC")
        fighters = c.fetchall()   
        return render_template('rank.html', fighters=fighters)
    
@app.route('/arcadeFight', methods=['GET', 'POST'])
def arcadeFight():
    
    if request.method == 'GET':
        return render_template('arcadeFight.html')
    else:
        return render_template('index.html')

@app.route('/result', methods=["POST"])
def result():
    # Connection the database
    connect = sqlite3.connect('fightClub.db', check_same_thread=False)
    c = connect.cursor()
    
    output = request.get_json()
    result = json.loads(output)
    
    # Result dictionary structure : {'winner': 'artin', 'loser': 'ahoora'}
    
    winnerpy = result['winner']
    loserpy = result['loser']
    
    c.execute("UPDATE players SET win = win + 1 WHERE username = ?", (winnerpy,))
    c.execute("UPDATE players SET lose = lose + 1 WHERE username = ?", (loserpy,))
    
    # c.execute("INSERT INTO players (username) VALUES ('ALOY')")
    # Close the database connection
    connect.commit()
    connect.close() 
    return render_template('index.html')